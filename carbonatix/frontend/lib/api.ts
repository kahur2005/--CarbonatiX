import { createBrowserClient } from "./supabase";
import type {
  CompanyInput,
  DocumentExtractionResult,
  EmissionInput,
  EmissionResult,
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
