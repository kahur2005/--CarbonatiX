import { createBrowserClient } from "./supabase";
import type {
  Company,
  CompanyInput,
  DocumentExtractionResult,
  EmissionInput,
  EmissionResult,
  OperationalInput,
  RunResult,
  SuggestCapInput,
  SuggestCapResult,
} from "@/types/emissions";

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

export async function postSuggestCap(input: SuggestCapInput): Promise<SuggestCapResult> {
  const res = await fetch(`${BASE}/company/suggest-cap`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
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
