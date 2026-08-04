"""The advisor package: regulation corpus and prompt assembly.

Task 14 owns the actual model call. Everything under this package
(`corpus.py`, `prompt.py`) is pure -- no I/O, no network, no model calls --
so it can be unit-tested without a live API key and so the anti-hallucination
guarantees (verbatim clause injection, numeral verification) are checkable in
isolation from whatever provider Task 14 chooses.
"""
