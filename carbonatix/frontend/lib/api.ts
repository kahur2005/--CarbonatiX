import { createBrowserClient } from "./supabase";
import type {
  Company,
  CompanyInput,
  DocumentExtractionResult,
  EmissionInput,
  EmissionResult,
  OperationalInput,
  RecommendationEvent,
  RunResult,
  SuggestCapInput,
  SuggestCapResult,
} from "@/types/emissions";

/** Thrown by `getRun` when the caller isn't authenticated, the run id
 * doesn't exist, or it belongs to another tenant -- `app/runs.py`'s `get`
 * returns a bare 404 for the latter two cases indistinguishably (see its
 * docstring: a leaked run id from another tenant must not resolve here
 * either). The dashboard page uses this to show one Indonesian message
 * without repeating the raw response body. */
export class RunNotFoundError extends Error {}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await createBrowserClient().auth.getSession();
  return {
    "Content-Type": "application/json",
    ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}),
  };
}

/** Auth header only -- no `Content-Type`. `fetch` sets the multipart
 * boundary itself when the body is a `FormData`; pinning `application/json`
 * here (as `authHeaders` does) would send the wrong content type. */
async function authHeaderOnly(): Promise<HeadersInit> {
  const { data } = await createBrowserClient().auth.getSession();
  return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}

export async function postEmissions(input: EmissionInput): Promise<EmissionResult> {
  const res = await fetch(`${BASE}/emissions`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function putCompany(input: CompanyInput): Promise<void> {
  const res = await fetch(`${BASE}/company`, {
    method: "PUT",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await res.text());
}

/** The caller's saved site specification -- the twin seeds the dryer/EAF/PLTU
 * nodes' site-spec fields (`dryerThermalEfficiency`, `secEafKwhPerTAlloy`,
 * `efCaptivePltu`) from this. Throws (never returns a placeholder company)
 * if onboarding hasn't been completed, so the twin page can tell "no
 * profile yet" apart from "profile failed to load". */
export async function getCompany(): Promise<Company> {
  const res = await fetch(`${BASE}/company`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** Commits one production interval: `POST /runs`. Unlike `postEmissions`,
 * this persists a row and pairs it with the forecast snapshot behind its
 * compliance figure -- see `app/runs.py`'s `commit`. Site-spec values are
 * never part of this payload; the backend reads them from the caller's
 * stored company profile, not from anything the twin sends here. */
export async function postRun(input: OperationalInput): Promise<RunResult> {
  const res = await fetch(`${BASE}/runs`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** Fetches one previously committed run: `GET /runs/{id}`. The dashboard
 * (`app/dashboard/page.tsx`) is this function's only caller -- it reads the
 * run's stored `forecastSnapshot` for its price charts rather than calling
 * `GET /forecasts` itself, so the page always shows the prices the run was
 * actually computed against (see `app/runs.py`'s `get`/`commit` docstrings),
 * never today's. Throws `RunNotFoundError` on a 404 (missing id, or a
 * leaked/guessed id belonging to another tenant -- the backend returns the
 * same 404 for both) so the page can show one fixed Indonesian message
 * instead of the raw response body. */
export async function getRun(id: string): Promise<RunResult> {
  const res = await fetch(`${BASE}/runs/${id}`, {
    headers: await authHeaders(),
  });
  if (res.status === 404) throw new RunNotFoundError(await res.text());
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function postSuggestCap(input: SuggestCapInput): Promise<SuggestCapResult> {
  const res = await fetch(`${BASE}/company/suggest-cap`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/**
 * Streams `GET /runs/{id}/recommendation` -- the four-stage advisor
 * pipeline (`app/advisor/pipeline.py`) framed as Server-Sent Events.
 *
 * Deliberately not `EventSource`: the route is guarded by
 * `current_user_id` (`app/auth.py`), which accepts only an
 * `Authorization: Bearer <supabase-jwt>` header with no cookie or
 * query-string fallback, and `EventSource` has no way to attach a custom
 * header. `fetch` with a streaming body reader is used instead, carrying
 * the same `authHeaders()` every other authenticated call in this module
 * uses, and the `data: ...\n\n` framing `recommendation.format_stream`
 * writes is parsed by hand below.
 *
 * Yields one parsed event per SSE frame. A frame that fails to parse is
 * skipped rather than thrown: one malformed frame must not take down the
 * whole stream, since every consumer of this generator already has to
 * tolerate a stream that ends early or errors mid-flight (see
 * `components/advisor/NodeGraph.tsx`).
 */
export async function* streamRecommendation(
  runId: string,
  signal?: AbortSignal,
): AsyncGenerator<RecommendationEvent> {
  const res = await fetch(`${BASE}/runs/${runId}/recommendation`, {
    headers: await authHeaders(),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(await res.text().catch(() => res.statusText));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sepIndex = buffer.indexOf("\n\n");
      while (sepIndex !== -1) {
        const frame = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
        if (dataLine) {
          try {
            yield JSON.parse(dataLine.slice("data: ".length)) as RecommendationEvent;
          } catch {
            // Malformed frame -- skip it, do not throw and kill the stream.
          }
        }
        sepIndex = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Posts one document for OCR candidate extraction. Never writes to the
 * company profile or a run -- the caller decides, per candidate, whether
 * and how to use the returned values (see `components/twin/UploadDropzone.tsx`). */
export async function postDocument(
  file: File,
  profile: "site_spec" | "operational",
): Promise<DocumentExtractionResult> {
  const body = new FormData();
  body.append("file", file);
  body.append("profile", profile);
  const res = await fetch(`${BASE}/documents`, {
    method: "POST",
    headers: await authHeaderOnly(),
    body,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
