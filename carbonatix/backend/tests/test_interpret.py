"""Contract tests for GPT-5.6 Sol document interpretation.

`AsyncOpenAI` is replaced at the client boundary; no test makes a network call.
"""

import json

import pytest

from app.ingestion import interpret
from app.ingestion.document_vision import Element, ExtractionFailed, ParsedDocument

DOC = ParsedDocument(
    elements=[
        Element(
            label="table",
            text=(
                "Bijih basah diterima | 10.000 | ton\n"
                "Bijih kering setara | 6.800 | ton"
            ),
            table_rows=[
                ["Bijih basah diterima", "10.000", "ton"],
                ["Bijih kering setara", "6.800", "ton"],
            ],
            score=0.96,
            page=0,
        )
    ],
    page_count=1,
)


class _Captured:
    def __init__(
        self,
        content: str | None = '{"fields": {}}',
        *,
        finish_reason: str = "stop",
        error: Exception | None = None,
    ):
        self.content = content
        self.finish_reason = finish_reason
        self.error = error
        self.init: dict = {}
        self.kwargs: dict = {}


def _fake_openai(captured: _Captured):
    class _Message:
        content = captured.content

    class _Choice:
        message = _Message()
        finish_reason = captured.finish_reason

    class _Response:
        def __init__(self):
            self.choices = [_Choice()]

    class _Completions:
        async def create(self, **kwargs):
            captured.kwargs = kwargs
            if captured.error is not None:
                raise captured.error
            return _Response()

    class _Chat:
        completions = _Completions()

    class _Fake:
        def __init__(self, **kwargs):
            captured.init = kwargs
            self.chat = _Chat()

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

    return _Fake


@pytest.fixture
def elice_env(monkeypatch):
    monkeypatch.setenv("ELICE_API_KEY", "test-key")
    monkeypatch.setenv("ELICE_BASE_URL", "https://gateway.example/uuid/v1")


async def _readings(monkeypatch, payload: object):
    captured = _Captured(json.dumps(payload))
    monkeypatch.setattr(interpret, "AsyncOpenAI", _fake_openai(captured))
    return await interpret.interpret(DOC, "operational")


@pytest.mark.asyncio
async def test_prompt_contains_verbatim_document_and_exact_profile_fields(
    monkeypatch, elice_env
):
    captured = _Captured()
    monkeypatch.setattr(interpret, "AsyncOpenAI", _fake_openai(captured))

    await interpret.interpret(DOC, "operational")

    prompt = captured.kwargs["messages"][0]["content"]
    assert DOC.full_text() in prompt
    for field in interpret.FIELDS_BY_PROFILE["operational"]:
        assert f"- {field}" in prompt
    for field in interpret.FIELDS_BY_PROFILE["site_spec"]:
        assert field not in prompt


@pytest.mark.asyncio
async def test_prompt_defines_all_outcomes_and_forbids_invention_or_computation(
    monkeypatch, elice_env
):
    captured = _Captured()
    monkeypatch.setattr(interpret, "AsyncOpenAI", _fake_openai(captured))

    await interpret.interpret(DOC, "operational")

    prompt = captured.kwargs["messages"][0]["content"]
    for text in (
        "transcribed",
        "derived",
        "null",
        "evidence",
        "raw_value",
        "operands",
        "difference_over_total",
        "ratio",
        "percentage_of_total",
        "JANGAN mengarang angka",
        "JANGAN menghitung hasil derivasi",
        '"fields"',
    ):
        assert text in prompt


@pytest.mark.asyncio
async def test_request_uses_exact_gateway_contract(monkeypatch, elice_env):
    captured = _Captured()
    monkeypatch.setattr(interpret, "AsyncOpenAI", _fake_openai(captured))

    await interpret.interpret(DOC, "operational")

    assert captured.init == {
        "api_key": "test-key",
        "base_url": "https://gateway.example/uuid/v1",
    }
    assert set(captured.kwargs) == {
        "model",
        "messages",
        "max_completion_tokens",
        "reasoning_effort",
        "response_format",
    }
    assert captured.kwargs["model"] == "gpt-5.6-sol"
    assert captured.kwargs["reasoning_effort"] == "high"
    assert captured.kwargs["max_completion_tokens"] == 8000
    assert captured.kwargs["response_format"] == {"type": "json_object"}
    assert "max_tokens" not in captured.kwargs


@pytest.mark.asyncio
async def test_parses_a_transcribed_reading_verbatim(monkeypatch, elice_env):
    readings = await _readings(
        monkeypatch,
        {
            "fields": {
                "wet_ore_input_tons": {
                    "basis": "transcribed",
                    "evidence": "Bijih basah diterima | 10.000 | ton",
                    "raw_value": "10.000",
                    "operands": [],
                    "operation": "",
                    "note": "dari tabel",
                }
            }
        },
    )

    reading = readings["wet_ore_input_tons"]
    assert reading == interpret.FieldReading(
        basis="transcribed",
        evidence="Bijih basah diterima | 10.000 | ton",
        raw_value="10.000",
        operands=[],
        operation="",
        note="dari tabel",
    )


@pytest.mark.asyncio
async def test_parses_derived_operands_without_a_computed_result(monkeypatch, elice_env):
    readings = await _readings(
        monkeypatch,
        {
            "fields": {
                "moisture_content_pct": {
                    "basis": "derived",
                    "evidence": "",
                    "raw_value": None,
                    "operands": ["10.000", "6.800"],
                    "operation": "difference_over_total",
                    "note": "basah dikurangi kering, dibagi basah",
                    "result": "0,32",
                }
            }
        },
    )

    reading = readings["moisture_content_pct"]
    assert reading.basis == "derived"
    assert reading.operands == ["10.000", "6.800"]
    assert reading.operation == "difference_over_total"
    assert not hasattr(reading, "result")


@pytest.mark.asyncio
async def test_omitted_fields_become_not_found_and_invented_fields_are_dropped(
    monkeypatch, elice_env
):
    readings = await _readings(
        monkeypatch,
        {"fields": {"harga_nikel": {"basis": "transcribed", "raw_value": "99.999"}}},
    )

    assert set(readings) == set(interpret.FIELDS_BY_PROFILE["operational"])
    assert "harga_nikel" not in readings
    assert all(reading == interpret.FieldReading() for reading in readings.values())


@pytest.mark.asyncio
async def test_non_dict_entry_and_invalid_basis_fail_safe_to_default(
    monkeypatch, elice_env
):
    readings = await _readings(
        monkeypatch,
        {
            "fields": {
                "wet_ore_input_tons": ["transcribed", "10.000"],
                "moisture_content_pct": {
                    "basis": "calculated",
                    "raw_value": "32",
                },
            }
        },
    )

    assert readings["wet_ore_input_tons"] == interpret.FieldReading()
    assert readings["moisture_content_pct"] == interpret.FieldReading()


@pytest.mark.asyncio
async def test_malformed_leaf_shapes_are_not_coerced(monkeypatch, elice_env):
    readings = await _readings(
        monkeypatch,
        {
            "fields": {
                "wet_ore_input_tons": {
                    "basis": "transcribed",
                    "evidence": 10000,
                    "raw_value": 10000,
                    "operands": ["10.000", 6800],
                    "operation": ["ratio"],
                    "note": True,
                }
            }
        },
    )

    reading = readings["wet_ore_input_tons"]
    assert reading.basis == "transcribed"
    assert reading.evidence == ""
    assert reading.raw_value is None
    assert reading.operands == []
    assert reading.operation == ""
    assert reading.note == ""


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "content",
    [
        "bukan JSON",
        "[]",
        "{}",
        '{"fields": null}',
        '{"fields": []}',
        '{"fields":',
    ],
)
async def test_malformed_response_shapes_raise_extraction_failed(
    monkeypatch, elice_env, content
):
    captured = _Captured(content)
    monkeypatch.setattr(interpret, "AsyncOpenAI", _fake_openai(captured))

    with pytest.raises(ExtractionFailed):
        await interpret.interpret(DOC, "operational")


@pytest.mark.asyncio
@pytest.mark.parametrize("content", ["", None])
async def test_empty_completion_raises_extraction_failed(
    monkeypatch, elice_env, content
):
    captured = _Captured(content)
    monkeypatch.setattr(interpret, "AsyncOpenAI", _fake_openai(captured))

    with pytest.raises(ExtractionFailed, match="empty"):
        await interpret.interpret(DOC, "operational")


@pytest.mark.asyncio
async def test_length_truncation_raises_before_parsing_partial_json(
    monkeypatch, elice_env
):
    captured = _Captured(
        '{"fields": {"wet_ore_input_tons": {"basis": "transcribed"}}',
        finish_reason="length",
    )
    monkeypatch.setattr(interpret, "AsyncOpenAI", _fake_openai(captured))

    with pytest.raises(ExtractionFailed, match="truncated"):
        await interpret.interpret(DOC, "operational")


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", ["ELICE_API_KEY", "ELICE_BASE_URL"])
async def test_missing_configuration_names_the_variable(monkeypatch, missing):
    monkeypatch.setenv("ELICE_API_KEY", "test-key")
    monkeypatch.setenv("ELICE_BASE_URL", "https://gateway.example/uuid/v1")
    monkeypatch.delenv(missing)

    with pytest.raises(ExtractionFailed, match=missing):
        await interpret.interpret(DOC, "operational")


@pytest.mark.asyncio
async def test_provider_exception_maps_to_extraction_failed(monkeypatch, elice_env):
    captured = _Captured(error=RuntimeError("gateway unavailable"))
    monkeypatch.setattr(interpret, "AsyncOpenAI", _fake_openai(captured))

    with pytest.raises(ExtractionFailed, match="gateway unavailable"):
        await interpret.interpret(DOC, "operational")
