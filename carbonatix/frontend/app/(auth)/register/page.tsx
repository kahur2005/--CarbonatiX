"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Flame } from "lucide-react";
import { createBrowserClient, translateAuthError } from "@/lib/supabase";
import { useTheme } from "@/components/shell/ThemeProvider";
import { Card, Mono } from "@/components/shell/primitives";

export default function RegisterPage() {
  const router = useRouter();
  const { colors: C } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const supabase = createBrowserClient();
    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) {
      setError(translateAuthError(authError.message));
      setPending(false);
      return;
    }

    // With mailer_autoconfirm off, signUp succeeds without a session —
    // never send the user into an authenticated route unauthenticated.
    if (data.session) {
      router.push("/onboarding");
      return;
    }

    setPending(false);
    setNeedsConfirmation(true);
  }

  const inputStyle = {
    background: C.panel,
    border: `1px solid ${C.border}`,
    color: C.text,
  };

  return (
    <div
      className="flex flex-1 flex-col items-center justify-center px-4"
      style={{
        background: `radial-gradient(circle at 50% 20%, ${C.sceneA} 0%, ${C.bg} 55%)`,
        minHeight: "100vh",
      }}
    >
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 flex items-center gap-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded"
            style={{ background: `linear-gradient(135deg, ${C.cyan}, ${C.violet})` }}
          >
            <Flame size={16} color="#fff" />
          </div>
          <div>
            <h1
              className="text-xl font-bold tracking-wider"
              style={{ fontFamily: "var(--font-display), sans-serif", color: C.text }}
            >
              Daftar SmartSmelt
            </h1>
            <Mono className="text-[10px]" style={{ color: C.muted }}>
              Buat akun untuk memantau emisi smelter
            </Mono>
          </div>
        </div>

        {needsConfirmation ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm leading-relaxed" style={{ color: C.text }}>
              Periksa email Anda untuk konfirmasi akun sebelum masuk.
            </p>
            <p className="text-sm" style={{ color: C.dimText }}>
              Kami mengirim tautan konfirmasi ke{" "}
              <Mono style={{ color: C.cyan }}>{email}</Mono>. Setelah dikonfirmasi,
              masuk dengan email dan kata sandi Anda.
            </p>
            <Link
              href="/login"
              className="mt-2 rounded-md px-5 py-2.5 text-center text-sm font-bold tracking-wider text-white transition-opacity hover:opacity-90"
              style={{
                background: `linear-gradient(135deg, ${C.cyan}, ${C.violet})`,
                fontFamily: "var(--font-mono), monospace",
              }}
            >
              Ke halaman masuk
            </Link>
          </div>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="email" className="text-sm font-medium" style={{ color: C.text }}>
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="rounded px-3 py-2 text-sm outline-none"
                  style={inputStyle}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="password" className="text-sm font-medium" style={{ color: C.text }}>
                  Kata Sandi
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="rounded px-3 py-2 text-sm outline-none"
                  style={inputStyle}
                />
              </div>

              {error && (
                <p role="alert" className="text-sm" style={{ color: C.red }}>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={pending}
                className="mt-2 rounded-md px-5 py-2.5 text-sm font-bold tracking-wider text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{
                  background: `linear-gradient(135deg, ${C.cyan}, ${C.violet})`,
                  fontFamily: "var(--font-mono), monospace",
                }}
              >
                {pending ? "Memproses..." : "Daftar"}
              </button>
            </form>

            <p className="mt-6 text-center text-sm" style={{ color: C.dimText }}>
              Sudah punya akun?{" "}
              <Link href="/login" className="font-medium underline" style={{ color: C.cyan }}>
                Masuk
              </Link>
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
