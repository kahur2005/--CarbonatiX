import { createBrowserClient as create } from "@supabase/ssr";

/**
 * The browser Supabase client. `@supabase/ssr`'s `createBrowserClient`
 * stores the session in cookies as well as local storage, so `proxy.ts`
 * (running on the server) can see the same session -- a plain
 * `@supabase/supabase-js` client would leave the session invisible there.
 *
 * `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are read from
 * the environment and are intentionally empty in `.env.example`: no
 * Supabase project has been provisioned yet.
 */
export function createBrowserClient() {
  return create(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/**
 * A short, non-exhaustive translation of the Supabase Auth error messages
 * this app is most likely to surface, for display in Bahasa Indonesia.
 * Messages not in this table fall back to the original Supabase text --
 * better an English sentence than a blank error box for a case this table
 * doesn't yet cover.
 */
const AUTH_ERROR_ID: Record<string, string> = {
  "Invalid login credentials": "Email atau kata sandi salah.",
  "Email not confirmed": "Email belum dikonfirmasi. Periksa kotak masuk Anda.",
  "User already registered": "Email ini sudah terdaftar.",
  "Password should be at least 6 characters": "Kata sandi minimal 6 karakter.",
  "Signup requires a valid password": "Kata sandi tidak valid.",
  "Unable to validate email address: invalid format": "Format email tidak valid.",
};

export function translateAuthError(message: string): string {
  return AUTH_ERROR_ID[message] ?? message;
}
