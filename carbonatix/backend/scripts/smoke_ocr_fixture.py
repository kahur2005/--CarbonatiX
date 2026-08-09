"""Live OCR smoke: fixture PDF → Helpy parse → Elice interpret → candidates.

Not for CI. Requires HELPY_BASE_URL, ELICE_API_KEY, ELICE_BASE_URL in the
environment (or a backend `.env` loaded via uvicorn-style --env-file).

Usage (from carbonatix/backend):

  .venv/Scripts/python.exe scripts/smoke_ocr_fixture.py site_spec \\
      ../../docs/fixtures/site-spec-imip-morowali.pdf
  .venv/Scripts/python.exe scripts/smoke_ocr_fixture.py operational \\
      ../../docs/fixtures/operational-laporan-harian.pdf
"""

from __future__ import annotations

import argparse
import asyncio
import json
import mimetypes
import sys
from pathlib import Path

# Allow `python scripts/smoke_ocr_fixture.py` without installing the package.
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))


def _load_dotenv() -> None:
    """Best-effort load of backend `.env` when keys are not already set."""
    env_path = _BACKEND_ROOT / ".env"
    if not env_path.is_file():
        return
    try:
        from dotenv import load_dotenv
    except ImportError:
        # Match uvicorn --env-file behaviour without requiring python-dotenv:
        # parse KEY=VALUE lines that are not already in the environment.
        import os

        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip("'").strip('"')
            if key and key not in os.environ:
                os.environ[key] = value
        return
    load_dotenv(env_path)


async def _run(profile: str, pdf_path: Path) -> int:
    from app.ingestion.document_vision import ExtractionFailed, parse
    from app.ingestion.interpret import interpret
    from app.ingestion.mapping import FIELDS_BY_PROFILE, readings_to_candidates

    if profile not in FIELDS_BY_PROFILE:
        print(f"Unknown profile: {profile}", file=sys.stderr)
        return 2

    file_bytes = pdf_path.read_bytes()
    media_type = mimetypes.guess_type(pdf_path.name)[0] or "application/pdf"

    try:
        parsed = await parse(file_bytes, media_type, pdf_path.name)
        readings = await interpret(parsed, profile)
        candidates = readings_to_candidates(readings, parsed)
    except ExtractionFailed as exc:
        print(f"ExtractionFailed: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001 — smoke script surfaces any failure
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    payload = [
        {
            "field": c.field,
            "value": c.value,
            "basis": c.basis,
            "confidence": c.confidence,
            "node": c.node,
            "evidence": c.evidence,
        }
        for c in candidates
    ]
    print(json.dumps(payload, indent=2, ensure_ascii=False))

    expected = set(FIELDS_BY_PROFILE[profile])
    returned = {c.field for c in candidates}
    missing_fields = expected - returned
    if missing_fields:
        print(
            f"WARNING: no candidates for fields: {sorted(missing_fields)}",
            file=sys.stderr,
        )

    # Operational fixture omits moisture on purpose; site_spec fixture has all six.
    deliberately_null = {"moisture_content_pct"} if profile == "operational" else set()
    null_when_expected = [
        c.field
        for c in candidates
        if c.value is None and c.field not in deliberately_null
    ]
    if all(c.value is None for c in candidates) and candidates:
        print(
            "ERROR: every candidate value is null; fixture was expected to contain figures.",
            file=sys.stderr,
        )
        return 1
    if null_when_expected:
        print(
            f"WARNING: null values (may need interpret/verify fix): {null_when_expected}",
            file=sys.stderr,
        )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Live OCR smoke against a fixture PDF")
    parser.add_argument("profile", choices=("site_spec", "operational"))
    parser.add_argument("pdf", type=Path, help="Path to fixture PDF")
    args = parser.parse_args()

    pdf_path = args.pdf.resolve()
    if not pdf_path.is_file():
        print(f"PDF not found: {pdf_path}", file=sys.stderr)
        return 2

    _load_dotenv()
    return asyncio.run(_run(args.profile, pdf_path))


if __name__ == "__main__":
    raise SystemExit(main())
