"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase";
import { getCompany } from "@/lib/api";
import { useTheme } from "@/components/shell/ThemeProvider";
import { Mono } from "@/components/shell/primitives";

export default function HomePage() {
  const router = useRouter();
  const { colors: C } = useTheme();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createBrowserClient();
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        router.replace("/login");
        return;
      }
      try {
        await getCompany();
        if (!cancelled) router.replace("/dashboard");
      } catch {
        if (!cancelled) router.replace("/onboarding");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ background: C.bg, color: C.dimText }}
    >
      <Mono className="text-xs">Memuat SmartSmelt ERP…</Mono>
    </div>
  );
}
