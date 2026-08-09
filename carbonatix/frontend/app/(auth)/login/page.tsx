"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Flame } from "lucide-react";
import { createBrowserClient, translateAuthError } from "@/lib/supabase";
import { useTheme } from "@/components/shell/ThemeProvider";
import { Card, Mono } from "@/components/shell/primitives";

export default function LoginPage() {
  const router = useRouter();
  const { colors: C } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const supabase = createBrowserClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(translateAuthError(authError.message));
      setPending(false);
      return;
    }

    router.push("/onboarding");
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
              SmartSmelt <span style={{ color: C.cyan }}>ERP</span>
            </h1>
            <Mono className="text-[10px]" style={{ color: C.muted }}>
              Masuk ke konsol operasi karbon
            </Mono>
          </div>
        </div>

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
              autoComplete="current-password"
              required
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
            {pending ? "Memproses..." : "Masuk"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm" style={{ color: C.dimText }}>
          Belum punya akun?{" "}
          <Link href="/register" className="font-medium underline" style={{ color: C.cyan }}>
            Daftar
          </Link>
        </p>
      </Card>
    </div>
  );
}
