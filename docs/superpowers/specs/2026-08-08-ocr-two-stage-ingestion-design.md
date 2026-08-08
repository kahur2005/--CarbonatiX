# Two-stage OCR ingestion — design

**Date:** 2026-08-08
**Status:** approved, not implemented
**Supersedes:** the single-call `ingestion/vision.py` path

## Why

Today one Claude vision call both reads the document and returns field values.
Three problems:

1. It cannot run at all — there is no `ANTHROPIC_API_KEY` in the environment, so
   `/documents` returns 502 for every upload. The module is dead code.
2. Quality on real documents is entirely unmeasured. Every test mocks the SDK,
   and the module docstring says so outright.
3. It cannot read tables reliably, which is the form operational data actually
   arrives in.

Helpy Document Vision replaces the reading half. A reasoning model replaces the
field-identification half. The human review step does not change.

## Verified before designing (2026-08-08)

A synthetic-but-realistic Indonesian smelter daily report (3 tables, Indonesian
number formats, a merged header, a field only obtainable by derivation) was
rendered to PDF and put through the live Helpy endpoint. Results:

- Submit → `job_id` → poll. One page completed in under 4 seconds.
- The shared `ELICE_API_KEY` authenticates against Helpy.
- Every planted value survived exactly: `10.000`, `6.800`, `1,8`, `18,4`, `85`,
  `15`, `412`, `72.250`, `12.750`, `85.000`, `85%`, `15%`, `100%`.
- Element `score` values around 0.96 — **undocumented, and the first honest
  input available for candidate confidence.**
- Reading order and section titles preserved.

Two discrepancies against Elice's published docs, both confirmed by request:

- `/healthz` and `/readyz` require `Authorization`; the docs list them as
  needing none.
- Job polling is `GET /v1/jobs/{id}`. The docs' endpoint table says
  `GET /jobs/{id}`, which returns 404. (The cURL example in the same document
  uses the correct path.)

One structural artifact, which drives a design decision: on the second table
Helpy inferred `colspan="2"` on a header and emitted an empty `<td>` in every
body row. All values were correct, but column indices shifted. **Positional
extraction would have silently read the wrong column.** Stage 2 must reason
over text, not index into cells.

## Non-goals

- Helpy Table Vision as a separate call. Document Vision already invokes it
  internally; a standalone table path is a later, separate change.
- XLSX. Helpy accepts PDF, PPT, PPTX, PNG, JPEG, JPG only. PRD §10 promises
  XLSX and this design does not deliver it — see Open questions.
- Removing human review. Every extracted value remains a candidate.
- Changing the emission engine, compliance, or the advisor.

## Architecture

```
upload ──> document_vision.py ──> interpret.py ──> verify.py ──> mapping.py ──> Candidate[]
           (Helpy, stage 1)       (Sol, stage 2)    (pure Python)  (deterministic)
```

### `ingestion/document_vision.py` (new)

Owns Helpy completely: submit, poll, timeout, error mapping.

- `parse(file_bytes, media_type) -> ParsedDocument`
- `POST {HELPY_BASE_URL}/v1/documents`, `multipart/form-data`, field `document`.
  `model` left at its default `eliceai/helpy-document-vision`.
  `configs = {"do_image_description": false, "do_chart_conversion": true}` —
  captions are useless for a numbers document and cost time; chart data is not.
- Poll `GET {HELPY_BASE_URL}/v1/jobs/{id}` every 2s until `status` is
  `succeeded` or `failure`, bounded at **90 seconds total**.
- Returns a normalized structure, never raw Helpy JSON:

  ```python
  @dataclass(frozen=True)
  class Element:
      label: str          # header | paragraph_title | table | text | ...
      text: str           # plain text; for a table, the cell text flattened
      table_rows: list[list[str]] | None
      score: float
      page: int

  @dataclass(frozen=True)
  class ParsedDocument:
      elements: list[Element]
      page_count: int
      def full_text(self) -> str: ...   # every element's text, for verification
  ```

  Normalizing here is what keeps a provider swap from leaking a response shape
  through the rest of the codebase.

### `ingestion/interpret.py` (new) — stage 2

`interpret(doc: ParsedDocument, profile: str) -> dict[str, FieldReading]`

Calls `gpt-5.6-sol` through the existing Elice endpoint, reusing the client
pattern in `advisor/pipeline.py` (including its parameter allowlist —
`response_format` is permitted, so the reply is schema-constrained rather than
free JSON). `reasoning_effort="high"`: verification catches fabrication but
cannot catch *choosing the wrong field*, e.g. reading Fe where Ni was asked
for, so model quality still carries weight.

The model is asked for, per field in `FIELDS_BY_PROFILE[profile]`:

```python
@dataclass(frozen=True)
class FieldReading:
    basis: Literal["transcribed", "derived"] | None   # None = not found
    evidence: str          # verbatim text from the document
    raw_value: str | None  # transcribed only, as printed: "10.000", "1,8"
    operands: list[str]    # derived only, each verbatim from the document
    operation: str         # derived only, e.g. "(a - b) / a"
    note: str              # short human-readable rationale
```

**The model never returns a computed number.** For a derived field it returns
the operands and the operation; the value is produced downstream.

### `ingestion/verify.py` (new) — verification, pure Python, no model

Its own module rather than a helper inside `interpret.py`: it is the
safety-critical step, it must be testable without any model mocking at all, and
keeping it separate makes it impossible to accidentally give it access to the
model client. Runs before anything becomes a `Candidate`.

- **Transcribed:** `evidence` must appear verbatim in `doc.full_text()`, and
  `raw_value` must appear within that evidence. The number is then parsed with
  Indonesian locale rules (`.` groups thousands, `,` marks the decimal) by a
  new `parse_id_number()` in this module.

  Note for the implementer: this is **not** a reuse of
  `advisor/prompt.py::_canonical`, despite the surface similarity. That function
  canonicalizes a numeral into a string for set comparison; this one parses a
  string into a `float`. Different outputs, different failure modes, and the
  advisor's guard is not a place to introduce a shared dependency lightly.
  Duplicating the locale rules in two well-tested places is the cheaper mistake.
- **Derived:** every operand must appear verbatim in `doc.full_text()`. Each is
  locale-parsed, then **Python evaluates `operation`** over a fixed, closed set
  of permitted forms (difference-over-total, ratio, percentage-of-total). The
  model's own arithmetic is never used and never compared against.
- Any check failing → that field becomes `value=None`, `confidence=0.0`,
  surfaced for manual entry. Never a guess, never a silent drop.
- `operation` is matched against the permitted set, never `eval`'d.

### `ingestion/mapping.py` (existing)

Unchanged in behaviour. `Candidate` gains three fields:

```python
basis: Literal["transcribed", "derived"] | None
evidence: str        # what the value was read from
derivation: str      # human-readable, derived only: "(10.000 − 6.800) / 10.000"
```

`confidence` stops being the hardcoded `0.75`: transcribed values carry the
`score` of the element they came from, derived values the **minimum** score
across their operands' elements. Still no `accepted` field, still nothing in
this package writes a candidate into a company or run.

### `ingestion/vision.py`

Deleted, together with the `anthropic` dependency in `pyproject.toml` and the
`ANTHROPIC_API_KEY` reference. It is the last consumer; the advisor already
moved to Elice. One provider, one key.

## Failure semantics

| Failure | Result |
|---|---|
| Helpy submit fails (network, bad key, 4xx/5xx) | `ExtractionFailed` → 502, existing message |
| Helpy job returns `status: "failure"` | same |
| Poll exceeds 90s | same |
| Stage 2 errors, or reply fails schema validation | same |
| One field fails verification | that field only → `value=None`, `confidence=0.0` |
| Parsed, but none of the profile's fields present | **not** an error → zero candidates, new UI state |

The user-facing message stays "Could not read the document. Enter the values
manually." — the distinction between stage 1 and stage 2 failure belongs in
logs, not in a message that tells the user to do the same thing either way.

## Limits

- **Upload cap: 20 MB.** `/documents` currently does an unbounded
  `await file.read()`. Enforce by checking `UploadFile.size` when the client
  supplied a length, and additionally by reading in bounded chunks and aborting
  past the cap — a client-supplied size alone is not a limit, since it can be
  absent or wrong.
- **Frontend timeout.** `lib/api.ts::postDocument` has none, and this request
  now legitimately takes 10-20s. Add one above the 90s server bound.

## UI

- Derived candidates render visually distinct from transcribed ones, showing
  the derivation string. Same principle as the synthetic-forecast badge and the
  placeholder-citation chip: provisional data carries its label to the pixel.
- New empty state: document read successfully, none of this profile's fields
  found. Distinct from the failure state.
- `confidenceIsPlaceholder` becomes `false`, with the caveat below.

## Configuration

- `HELPY_BASE_URL` — new. `https://mlapi.run/3886be6c-3e1b-4c4b-be28-0f7cafbee0ef`
- Auth reuses `ELICE_API_KEY`. Deliberate: one Elice account, one key, two
  deployments. Document it where the constant lives, because a reader will
  otherwise expect a `HELPY_API_KEY`.
- Both `ELICE_BASE_URL` and `HELPY_BASE_URL` are model-specific deployment
  URLs. Neither can be pointed at the other.

## Testing

No test calls Helpy or Sol; both are mocked at the client boundary, matching
the existing convention.

**Golden fixture:** the real Helpy response captured on 2026-08-08 is committed
as a test fixture — genuine provider output including the phantom `colspan` and
the Indonesian number formats. Stage 2 and verification tests run against real
parser output rather than an idealized mock.

Pinned behaviours:

- Evidence absent from the document → field `None`, never a candidate value
- Model returns wrong arithmetic on a derived field → Python's result wins
- Derivation citing an operand not in the document → rejected
- `10.000` → `10000` and `1,8` → `1.8`; specifically **not** `10.0`, the misread
  that would understate ore input by 1000×
- The phantom-colspan table does not shift a value into the wrong field
- Job `failure` → 502; poll timeout → 502
- `Candidate` still has no `accepted` field (existing test, unchanged)
- `score` → `confidence`; `value=None` → `confidence=0.0`
- Upload above 20 MB rejected before being read into memory

Existing `mapping.py` tests survive unchanged. The `vision.py` tests are removed
with the module.

## Open questions

1. **XLSX.** Helpy does not accept it; PRD §10 lists it as supported. Either add
   a separate spreadsheet path (a parser, not a model — an XLSX already *is*
   structured data) or amend the PRD. Not resolved here.
2. **Confidence is element-level, not field-level.** A table scoring 0.963 says
   the table was read well, not that the nickel grade specifically was. If that
   is too coarse to call honest, `confidenceIsPlaceholder` should stay `true`
   and the score be shown as a document-quality indicator instead.
3. **Table Vision** as a direct call, for uploads that are a bare table
   screenshot. Deferred by decision.
