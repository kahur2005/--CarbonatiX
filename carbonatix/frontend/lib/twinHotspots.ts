import { NODE_LABELS, type NodeId } from "@/lib/twin";

/** Demo GLB hotspot ids → product twin nodes. */
export const HOTSPOT_TO_NODE: Record<string, NodeId> = {
  dryer: "dryer",
  kiln: "kiln",
  furnace: "eaf",
  cooling: "pltu",
};

export const NODE_TO_HOTSPOT: Partial<Record<NodeId, string>> = {
  dryer: "dryer",
  kiln: "kiln",
  eaf: "furnace",
  pltu: "cooling",
};

export const GLB_HOTSPOT_NODES = [
  { id: "cooling", label: "PLTU / Cooling" },
  { id: "furnace", label: "EAF" },
  { id: "kiln", label: "Kiln" },
  { id: "dryer", label: "Dryer" },
] as const;

export function hotspotLabel(node: NodeId): string {
  return NODE_LABELS[node];
}
