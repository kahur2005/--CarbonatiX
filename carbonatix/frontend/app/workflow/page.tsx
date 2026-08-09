"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import AppShell from "@/components/shell/AppShell";
import { useTheme } from "@/components/shell/ThemeProvider";
import WorkflowCanvas from "@/components/workflow/WorkflowCanvas";

export default function WorkflowPage() {
  const { colors: C } = useTheme();

  return (
    <AppShell showFooter={false}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className="flex shrink-0 items-center gap-3 px-4 py-2.5"
          style={{
            borderBottom: `1px solid ${C.border}`,
            background: C.headerBg,
          }}
        >
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-opacity hover:opacity-80"
            style={{
              background: C.glassBg,
              border: `1px solid ${C.border}`,
              color: C.dimText,
              boxShadow: C.glassShadow,
            }}
          >
            <ArrowLeft size={12} />
            Dashboard
          </Link>
          <h1 className="text-sm font-semibold" style={{ color: C.text }}>
            AI Workflow (3 Layer)
          </h1>
        </div>

        <div className="min-h-0 flex-1">
          <WorkflowCanvas />
        </div>
      </div>
    </AppShell>
  );
}
