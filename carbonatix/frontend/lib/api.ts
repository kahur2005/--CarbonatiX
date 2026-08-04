import { createBrowserClient } from "./supabase";
import type { EmissionInput, EmissionResult } from "@/types/emissions";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await createBrowserClient().auth.getSession();
  return {
    "Content-Type": "application/json",
    ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}),
  };
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
