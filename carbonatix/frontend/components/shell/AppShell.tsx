"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getCompany } from "@/lib/api";
import AppFooter from "./AppFooter";
import AppHeader from "./AppHeader";
import { useTheme } from "./ThemeProvider";

export default function AppShell({
  children,
  disclosure,
  showFooter = true,
}: {
  children: ReactNode;
  disclosure?: string;
  showFooter?: boolean;
}) {
  const { colors: C } = useTheme();
  const [facilityName, setFacilityName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const company = await getCompany();
        if (!cancelled) setFacilityName(company.name);
      } catch {
        if (!cancelled) setFacilityName(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ background: C.bg, color: C.text }}
    >
      <AppHeader facilityName={facilityName} />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      {showFooter ? <AppFooter disclosure={disclosure} /> : null}
    </div>
  );
}
