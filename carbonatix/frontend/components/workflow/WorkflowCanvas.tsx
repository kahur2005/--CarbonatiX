"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Play, X, Plus, Minus } from "lucide-react";
import { useTheme } from "@/components/shell/ThemeProvider";

/* ------------------------------------------------------------------ *
 *  3-Layer AI Workflow — ComfyUI-style interactive canvas (demo)
 *  L1 Perception & Retrieval → L2 Reasoning & Orchestration → L3 Action & Delivery
 * ------------------------------------------------------------------ */

type NodeType = "io" | "orchestrator" | "agent" | "model" | "node";

interface Port {
  id: string;
  label: string;
}

interface WorkflowNode {
  id: string;
  type: NodeType;
  layer: number;
  x: number;
  y: number;
  title: string;
  subtitle: string;
  inputs: Port[];
  outputs: Port[];
  process: string;
  stack: string[];
}

interface Edge {
  id: string;
  sn: string;
  sp: string;
  tn: string;
  tp: string;
}

interface Band {
  layer: number;
  x: number;
  w: number;
  tag: string;
  name: string;
  color: string;
}

interface CanvasPalette {
  bg: string;
  panel: string;
  border: string;
  nodeBg: string;
  nodeHead: string;
  nodeBorder: string;
  chipBorder: string;
  ghostBg: string;
  text: string;
  textStrong: string;
  textStack: string;
  textMid: string;
  textSub: string;
  textMuted: string;
  dotGrid: string;
  amber: string;
}

type DragState =
  | { mode: "pan"; sx: number; sy: number; ox: number; oy: number }
  | { mode: "node"; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean };

const TYPES: Record<NodeType, { label: string; color: string }> = {
  io: { label: "I/O", color: "#94a3b8" },
  orchestrator: { label: "Orchestrator", color: "#a78bfa" },
  agent: { label: "Agent", color: "#fbbf24" },
  model: { label: "Model", color: "#22d3ee" },
  node: { label: "Node / Tool", color: "#34d399" },
};

const NODE_W = 216;
const HEAD_H = 40;
const ROW_H = 24;
const SUB_H = 22;

function nodeHeight(n: Pick<WorkflowNode, "inputs" | "outputs">): number {
  return HEAD_H + SUB_H + Math.max(n.inputs.length, n.outputs.length, 1) * ROW_H + 8;
}

const BANDS: Band[] = [
  { layer: 0, x: 30, w: 300, tag: "LAYER 1", name: "Perception & Retrieval", color: "#c8a878" },
  { layer: 1, x: 360, w: 810, tag: "LAYER 2", name: "Reasoning & Orchestration", color: "#a78bfa" },
  { layer: 2, x: 1200, w: 470, tag: "LAYER 3", name: "Action & Delivery", color: "#86efac" },
];
const BAND_Y = 44;
const BAND_H = 560;

const NODES: WorkflowNode[] = [
  {
    id: "ingest",
    type: "io",
    layer: 0,
    x: 70,
    y: 120,
    title: "Data Ingestion",
    subtitle: "REST · CSV · IDX feed",
    inputs: [],
    outputs: [{ id: "o", label: "data" }],
    process:
      "Menarik data emisi smelter, parameter produksi, dan feed harga unit karbon dari IDX Carbon.",
    stack: ["Python", "FastAPI", "Airbyte", "IDX Carbon API"],
  },
  {
    id: "retriever",
    type: "node",
    layer: 0,
    x: 70,
    y: 340,
    title: "Context Retriever",
    subtitle: "RAG · pgvector",
    inputs: [],
    outputs: [{ id: "o", label: "context" }],
    process:
      "Mengambil potongan regulasi (Perpres 98/2021, POJK 14/2023) & metodologi relevan sebagai grounding agent.",
    stack: ["PostgreSQL", "pgvector", "LangChain"],
  },
  {
    id: "orch",
    type: "orchestrator",
    layer: 1,
    x: 380,
    y: 250,
    title: "Orchestrator",
    subtitle: "LangGraph",
    inputs: [
      { id: "i", label: "data" },
      { id: "c", label: "context" },
    ],
    outputs: [
      { id: "a", label: "→ analysis" },
      { id: "t", label: "→ trading" },
    ],
    process:
      "Mengatur alur kerja antar-agent, mengelola state bersama, retry, dan percabangan berdasarkan hasil analisis.",
    stack: ["LangGraph", "Redis (state)", "Celery"],
  },
  {
    id: "analysisAgent",
    type: "agent",
    layer: 1,
    x: 660,
    y: 90,
    title: "Emission Analysis Agent",
    subtitle: "reasoning",
    inputs: [{ id: "i", label: "task" }],
    outputs: [{ id: "o", label: "result" }],
    process:
      "Menghitung intensitas tCO₂/tNi, membandingkan ke benchmark LME (20) & peer, mendeteksi anomali emisi.",
    stack: ["Qwen2.5", "Pandas", "emission model"],
  },
  {
    id: "tradingAgent",
    type: "agent",
    layer: 1,
    x: 660,
    y: 410,
    title: "Carbon Trading Agent",
    subtitle: "reasoning + RAG",
    inputs: [{ id: "i", label: "task" }],
    outputs: [{ id: "o", label: "signal" }],
    process:
      "Mengevaluasi surplus/defisit terhadap cap, mencocokkan peluang SPE-GRK, dan mensimulasi harga di IDX Carbon.",
    stack: ["Qwen2.5", "RAG retriever", "IDX Carbon API"],
  },
  {
    id: "llm",
    type: "model",
    layer: 1,
    x: 920,
    y: 250,
    title: "LLM Core",
    subtitle: "qwen2.5",
    inputs: [{ id: "i", label: "prompt" }],
    outputs: [{ id: "o", label: "completion" }],
    process: "Mesin reasoning & generation yang dipanggil seluruh agent melalui tool-calling.",
    stack: ["Qwen2.5 API", "qwen2.5-72b"],
  },
  {
    id: "dashboardAgent",
    type: "agent",
    layer: 2,
    x: 1240,
    y: 90,
    title: "Dashboard Agent",
    subtitle: "generation",
    inputs: [{ id: "i", label: "view" }],
    outputs: [{ id: "o", label: "ui" }],
    process:
      "Menyusun ringkasan naratif dan merender komponen dashboard serta skenario what-if.",
    stack: ["Qwen2.5", "React", "Recharts"],
  },
  {
    id: "recommend",
    type: "node",
    layer: 2,
    x: 1240,
    y: 250,
    title: "Recommendation Node",
    subtitle: "decision",
    inputs: [{ id: "i", label: "signal" }],
    outputs: [{ id: "o", label: "action" }],
    process:
      "Menyusun rekomendasi jual / beli / lindung nilai beserta estimasi nilai (Rp) dari sinyal trading.",
    stack: ["rule engine", "IDX Carbon API"],
  },
  {
    id: "render",
    type: "io",
    layer: 2,
    x: 1240,
    y: 410,
    title: "Dashboard Render",
    subtitle: "output",
    inputs: [
      { id: "i", label: "ui" },
      { id: "a", label: "action" },
    ],
    outputs: [],
    process:
      "Menyajikan KPI, monitoring emisi, dan rekomendasi trading ke pengguna secara real-time.",
    stack: ["React", "WebSocket", "Recharts"],
  },
];

const EDGES: Edge[] = [
  ["ingest", "o", "orch", "i"],
  ["retriever", "o", "orch", "c"],
  ["orch", "a", "analysisAgent", "i"],
  ["orch", "t", "tradingAgent", "i"],
  ["analysisAgent", "o", "llm", "i"],
  ["tradingAgent", "o", "llm", "i"],
  ["llm", "o", "dashboardAgent", "i"],
  ["tradingAgent", "o", "recommend", "i"],
  ["dashboardAgent", "o", "render", "i"],
  ["recommend", "o", "render", "a"],
].map((e, idx) => ({ id: `e${idx}`, sn: e[0], sp: e[1], tn: e[2], tp: e[3] }));

const MAX_LAYER = Math.max(...NODES.map((n) => n.layer));

function canvasPalette(theme: "dark" | "light", C: { amber: string }): CanvasPalette {
  if (theme === "light") {
    return {
      bg: "#F7F9FC",
      panel: "#FFFFFF",
      border: "#E2E8F0",
      nodeBg: "#FFFFFF",
      nodeHead: "#F1F5F9",
      nodeBorder: "#E2E8F0",
      chipBorder: "#CBD5E1",
      ghostBg: "#F1F5F9",
      text: "#0F172A",
      textStrong: "#1E293B",
      textStack: "#334155",
      textMid: "#475569",
      textSub: "#64748B",
      textMuted: "#94A3B8",
      dotGrid: "#DBE3EE",
      amber: C.amber,
    };
  }
  return {
    bg: "#0f1116",
    panel: "#12151c",
    border: "#1f242e",
    nodeBg: "#171b23",
    nodeHead: "#1c212b",
    nodeBorder: "#262c38",
    chipBorder: "#2a3140",
    ghostBg: "#1a1f28",
    text: "#e5e7eb",
    textStrong: "#c3cad6",
    textStack: "#d5dbe6",
    textMid: "#9aa3b2",
    textSub: "#7c8598",
    textMuted: "#6b7280",
    dotGrid: "#1c2230",
    amber: C.amber,
  };
}

function dot(PAL: CanvasPalette, c: string): CSSProperties {
  return {
    width: 10,
    height: 10,
    borderRadius: 10,
    background: PAL.bg,
    border: `2px solid ${c}`,
    display: "inline-block",
    flex: "0 0 auto",
  };
}

function btn(c: string): CSSProperties {
  return {
    background: c,
    color: "#0d0f14",
    border: "none",
    borderRadius: 7,
    padding: "7px 13px",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  };
}

function btnGhost(PAL: CanvasPalette): CSSProperties {
  return {
    background: PAL.ghostBg,
    color: PAL.textStrong,
    border: `1px solid ${PAL.chipBorder}`,
    borderRadius: 7,
    padding: "7px 11px",
    fontSize: 12.5,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

function Label({ PAL, children }: { PAL: CanvasPalette; children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: 0.8,
        color: PAL.textMuted,
        marginBottom: 7,
      }}
    >
      {children}
    </div>
  );
}

function Port({ PAL, c, l }: { PAL: CanvasPalette; c: string; l: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        fontSize: 12,
        color: PAL.textStrong,
        marginBottom: 5,
      }}
    >
      <span style={dot(PAL, c)} /> {l}
    </div>
  );
}

function Inspector({
  PAL,
  n,
  onClose,
}: {
  PAL: CanvasPalette;
  n: WorkflowNode;
  onClose: () => void;
}) {
  const t = TYPES[n.type];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span
          style={{
            fontSize: 9,
            textTransform: "uppercase",
            letterSpacing: 0.6,
            color: t.color,
            border: `1px solid ${t.color}55`,
            borderRadius: 5,
            padding: "2px 7px",
          }}
        >
          {t.label}
        </span>
        <span style={{ fontSize: 10, color: PAL.textMuted }}>Layer {n.layer + 1}</span>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onClose} style={{ ...btnGhost(PAL), padding: "2px 8px" }}>
          <X size={14} />
        </button>
      </div>
      <div style={{ fontSize: 17, fontWeight: 650, margin: "6px 0 2px" }}>{n.title}</div>
      <div
        style={{
          fontSize: 11.5,
          color: PAL.textSub,
          fontFamily: "var(--font-mono), monospace",
          marginBottom: 16,
        }}
      >
        {n.subtitle}
      </div>
      <Label PAL={PAL}>Proses kerja</Label>
      <div style={{ fontSize: 13, lineHeight: 1.65, color: PAL.textStrong, marginBottom: 18 }}>
        {n.process}
      </div>
      <Label PAL={PAL}>Tech stack</Label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 18 }}>
        {n.stack.map((s) => (
          <span
            key={s}
            style={{
              fontSize: 11.5,
              background: PAL.nodeHead,
              border: `1px solid ${PAL.chipBorder}`,
              borderRadius: 6,
              padding: "4px 9px",
              color: PAL.textStack,
              fontFamily: "var(--font-mono), monospace",
            }}
          >
            {s}
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 18 }}>
        <div style={{ flex: 1 }}>
          <Label PAL={PAL}>Input</Label>
          {n.inputs.length ? (
            n.inputs.map((p) => <Port key={p.id} PAL={PAL} c={t.color} l={p.label} />)
          ) : (
            <div style={{ fontSize: 12, color: PAL.textMuted }}>—</div>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <Label PAL={PAL}>Output</Label>
          {n.outputs.length ? (
            n.outputs.map((p) => <Port key={p.id} PAL={PAL} c={t.color} l={p.label} />)
          ) : (
            <div style={{ fontSize: 12, color: PAL.textMuted }}>—</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function WorkflowCanvas() {
  const { theme, colors: C } = useTheme();
  const PAL = useMemo(() => canvasPalette(theme, C), [theme, C]);

  const [nodes, setNodes] = useState<WorkflowNode[]>(() => NODES.map((n) => ({ ...n })));
  const [view, setView] = useState({ x: 24, y: 30, k: 0.74 });
  const [selected, setSelected] = useState<string | null>(null);
  const [runLayer, setRunLayer] = useState(-1);
  const running = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);

  const nodeMap = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);

  const portPos = useCallback(
    (nodeId: string, portId: string, side: "in" | "out") => {
      const n = nodeMap[nodeId];
      if (!n) return { x: 0, y: 0 };
      const list = side === "out" ? n.outputs : n.inputs;
      const i = Math.max(
        0,
        list.findIndex((p) => p.id === portId),
      );
      return {
        x: n.x + (side === "out" ? NODE_W - 5 : 5),
        y: n.y + HEAD_H + SUB_H + i * ROW_H + ROW_H / 2,
      };
    },
    [nodeMap],
  );

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    const k = Math.min(2.2, Math.max(0.3, view.k * (e.deltaY < 0 ? 1.1 : 0.9)));
    setView({ k, x: cx - ((cx - view.x) / view.k) * k, y: cy - ((cy - view.y) / view.k) * k });
  };

  const onBgPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-node]")) return;
    drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
    setSelected(null);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onNodePointerDown = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    e.stopPropagation();
    const n = nodeMap[id];
    if (!n) return;
    drag.current = {
      mode: "node",
      id,
      sx: e.clientX,
      sy: e.clientY,
      ox: n.x,
      oy: n.y,
      moved: false,
    };
    wrapRef.current?.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (d.mode === "pan") {
      setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }));
    } else if (d.mode === "node") {
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      setNodes((ns) =>
        ns.map((n) =>
          n.id === d.id ? { ...n, x: d.ox + dx / view.k, y: d.oy + dy / view.k } : n,
        ),
      );
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    if (d && d.mode === "node" && !d.moved) setSelected(d.id);
    drag.current = null;
  };

  const run = () => {
    if (running.current) return;
    running.current = true;
    setSelected(null);
    let l = 0;
    setRunLayer(0);
    const step = () => {
      l += 1;
      if (l > MAX_LAYER) {
        setTimeout(() => {
          setRunLayer(-1);
          running.current = false;
        }, 800);
        return;
      }
      setRunLayer(l);
      setTimeout(step, 1000);
    };
    setTimeout(step, 1000);
  };

  const fit = () => setView({ x: 24, y: 30, k: 0.74 });

  const nodeState = (n: WorkflowNode): "idle" | "done" | "active" =>
    runLayer < 0 ? "idle" : n.layer < runLayer ? "done" : n.layer === runLayer ? "active" : "idle";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: PAL.bg,
        color: PAL.text,
        fontFamily: "var(--font-body), system-ui, sans-serif",
        overflow: "hidden",
      }}
    >
      <style>{`@keyframes dash{to{stroke-dashoffset:-18}} @keyframes pulse{0%,100%{opacity:.55}50%{opacity:1}}`}</style>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 12px",
          borderBottom: `1px solid ${PAL.border}`,
          background: PAL.panel,
        }}
      >
        <div style={{ fontWeight: 650 }}>3-Layer AI Workflow</div>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: 1.2,
            textTransform: "uppercase",
            color: PAL.amber,
            background: `${PAL.amber}22`,
            border: `1px solid ${PAL.amber}55`,
            borderRadius: 5,
            padding: "2px 7px",
          }}
        >
          DUMMY
        </span>
        <div
          style={{
            fontSize: 12,
            color: PAL.textMuted,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          perception → reasoning → action
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={run} style={btn("#a78bfa")}>
          <Play size={14} fill="currentColor" />
          Run workflow
        </button>
        <button type="button" onClick={fit} style={btnGhost(PAL)}>
          Fit
        </button>
        <button
          type="button"
          onClick={() => setView((v) => ({ ...v, k: Math.min(2.2, v.k * 1.15) }))}
          style={btnGhost(PAL)}
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          onClick={() => setView((v) => ({ ...v, k: Math.max(0.3, v.k * 0.87) }))}
          style={btnGhost(PAL)}
        >
          <Minus size={14} />
        </button>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div
          ref={wrapRef}
          onWheel={onWheel}
          onPointerDown={onBgPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{
            flex: 1,
            position: "relative",
            overflow: "hidden",
            cursor: "grab",
            backgroundColor: PAL.bg,
            backgroundImage: `radial-gradient(${PAL.dotGrid} 1px, transparent 1px)`,
            backgroundSize: `${22 * view.k}px ${22 * view.k}px`,
            backgroundPosition: `${view.x}px ${view.y}px`,
            touchAction: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              transform: `translate(${view.x}px,${view.y}px) scale(${view.k})`,
              transformOrigin: "0 0",
            }}
          >
            {BANDS.map((b) => {
              const active = runLayer === b.layer;
              return (
                <div
                  key={b.tag}
                  style={{
                    position: "absolute",
                    left: b.x,
                    top: BAND_Y,
                    width: b.w,
                    height: BAND_H,
                    border: `1px ${active ? "solid" : "dashed"} ${b.color}${active ? "" : "44"}`,
                    borderRadius: 14,
                    background: active ? `${b.color}22` : `${b.color}12`,
                    transition: "background .3s, border-color .3s",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 12,
                      left: 14,
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: 1,
                        color: b.color,
                      }}
                    >
                      {b.tag}
                    </span>
                    <span style={{ fontSize: 11, color: PAL.textSub }}>{b.name}</span>
                  </div>
                </div>
              );
            })}

            <svg
              width={1620}
              height={720}
              style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}
            >
              {EDGES.map((ed) => {
                const s = portPos(ed.sn, ed.sp, "out");
                const t = portPos(ed.tn, ed.tp, "in");
                const k = Math.max(40, Math.abs(t.x - s.x) * 0.45);
                const src = nodeMap[ed.sn];
                const tgt = nodeMap[ed.tn];
                if (!src || !tgt) return null;
                const flowing = runLayer >= 0 && tgt.layer === runLayer && src.layer <= runLayer;
                const done = runLayer < 0 || tgt.layer < runLayer;
                const col = flowing ? TYPES[tgt.type].color : "#3a4152";
                return (
                  <path
                    key={ed.id}
                    d={`M ${s.x} ${s.y} C ${s.x + k} ${s.y}, ${t.x - k} ${t.y}, ${t.x} ${t.y}`}
                    fill="none"
                    stroke={col}
                    strokeWidth={flowing ? 2.4 : 1.6}
                    strokeDasharray={flowing ? "6 6" : "none"}
                    style={{
                      animation: flowing ? "dash .6s linear infinite" : "none",
                      opacity: runLayer >= 0 && !flowing && !done ? 0.35 : 0.9,
                    }}
                  />
                );
              })}
            </svg>

            {nodes.map((n) => {
              const t = TYPES[n.type];
              const h = nodeHeight(n);
              const st = nodeState(n);
              const isSel = selected === n.id;
              return (
                <div
                  key={n.id}
                  data-node
                  onPointerDown={(e) => onNodePointerDown(e, n.id)}
                  style={{
                    position: "absolute",
                    left: n.x,
                    top: n.y,
                    width: NODE_W,
                    height: h,
                    background: PAL.nodeBg,
                    border: `1px solid ${isSel ? t.color : PAL.nodeBorder}`,
                    borderRadius: 10,
                    boxShadow:
                      st === "active"
                        ? `0 0 0 2px ${t.color}, 0 8px 26px rgba(0,0,0,.5)`
                        : "0 6px 18px rgba(0,0,0,.4)",
                    opacity: st === "idle" && runLayer >= 0 ? 0.5 : 1,
                    cursor: "grab",
                    userSelect: "none",
                    transition: "box-shadow .2s, opacity .2s",
                  }}
                >
                  <div
                    style={{
                      height: HEAD_H,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "0 12px",
                      borderBottom: `1px solid ${PAL.nodeBorder}`,
                      borderTopLeftRadius: 10,
                      borderTopRightRadius: 10,
                      background: PAL.nodeHead,
                    }}
                  >
                    <span
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: 9,
                        background: t.color,
                        boxShadow: st === "active" ? `0 0 8px ${t.color}` : "none",
                        animation: st === "active" ? "pulse 1s infinite" : "none",
                      }}
                    />
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 12.5,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {n.title}
                    </div>
                    <span
                      style={{
                        fontSize: 9,
                        textTransform: "uppercase",
                        letterSpacing: 0.6,
                        color: t.color,
                        border: `1px solid ${t.color}55`,
                        borderRadius: 5,
                        padding: "1px 5px",
                      }}
                    >
                      {t.label}
                    </span>
                  </div>
                  <div
                    style={{
                      height: SUB_H,
                      display: "flex",
                      alignItems: "center",
                      padding: "0 12px",
                      fontSize: 10.5,
                      color: PAL.textSub,
                      fontFamily: "var(--font-mono), monospace",
                    }}
                  >
                    {n.subtitle}
                  </div>
                  <div style={{ position: "relative" }}>
                    {n.inputs.map((p, i) => (
                      <div
                        key={p.id}
                        style={{
                          position: "absolute",
                          left: 0,
                          top: i * ROW_H,
                          height: ROW_H,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 10.5,
                          color: PAL.textMid,
                        }}
                      >
                        <span style={dot(PAL, t.color)} /> {p.label}
                      </div>
                    ))}
                    {n.outputs.map((p, i) => (
                      <div
                        key={p.id}
                        style={{
                          position: "absolute",
                          right: 0,
                          top: i * ROW_H,
                          height: ROW_H,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: 10.5,
                          color: PAL.textMid,
                        }}
                      >
                        {p.label} <span style={dot(PAL, t.color)} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div
            style={{
              position: "absolute",
              left: 14,
              bottom: 14,
              display: "flex",
              gap: 14,
              background: `${PAL.panel}cc`,
              border: `1px solid ${PAL.border}`,
              borderRadius: 8,
              padding: "8px 12px",
              backdropFilter: "blur(4px)",
            }}
          >
            {Object.entries(TYPES).map(([k, v]) => (
              <div
                key={k}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  color: PAL.textStrong,
                }}
              >
                <span style={{ width: 9, height: 9, borderRadius: 9, background: v.color }} />{" "}
                {v.label}
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            width: 328,
            borderLeft: `1px solid ${PAL.border}`,
            background: PAL.panel,
            padding: 18,
            overflowY: "auto",
          }}
        >
          {selected && nodeMap[selected] ? (
            <Inspector PAL={PAL} n={nodeMap[selected]} onClose={() => setSelected(null)} />
          ) : (
            <div style={{ color: PAL.textMuted, fontSize: 13, lineHeight: 1.7 }}>
              <div style={{ fontWeight: 600, color: PAL.textStrong, marginBottom: 8 }}>
                Inspector
              </div>
              Klik node untuk melihat{" "}
              <b style={{ color: PAL.textMid }}>proses kerja</b> &{" "}
              <b style={{ color: PAL.textMid }}>tech stack</b>.
              <br />
              <br />
              Tiga lane = tiga layer workflow. Tekan{" "}
              <b style={{ color: "#a78bfa" }}>Run workflow</b> untuk melihat aliran menyala layer
              per layer.
              <br />
              <br />
              Scroll = zoom · seret kanvas = geser · seret node = tata ulang.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
