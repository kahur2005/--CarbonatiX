"use client";

import { Canvas } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { NODE_LABELS, NODE_ORDER, type NodeId } from "@/lib/twin";

/**
 * The 3D digital twin: five clickable process-stage meshes laid out left to
 * right in production order. This is the input interface, not decoration --
 * clicking a mesh is how `app/twin/page.tsx` opens that stage's `NodePanel`.
 * Primitive geometry only (a cylinder for the kiln, a box for the furnace);
 * there is deliberately no modelled asset to block on.
 */
export interface SceneProps {
  selectedNode: NodeId | null;
  onSelectNode: (node: NodeId) => void;
  /** tCO2e attributed to each node, or `null` while no live result is
   * available yet (still typing, or the last recompute failed). */
  badges: Partial<Record<NodeId, number | null>>;
  /** Node -> the Indonesian message from a 422 whose owning field lives on
   * that node (see `lib/twin.ts`'s `parseEmissionError`). A present entry
   * turns that node's mesh red and shows the message on its floating
   * label -- never as a banner detached from the node. */
  nodeErrors: Partial<Record<NodeId, string>>;
}

const NODE_X: Record<NodeId, number> = {
  stockpile: -8,
  dryer: -4,
  kiln: 0,
  eaf: 4,
  pltu: 8,
};

const BASE_COLOR: Record<NodeId, string> = {
  stockpile: "#a16207",
  dryer: "#0891b2",
  kiln: "#ea580c",
  eaf: "#7c3aed",
  pltu: "#334155",
};

const SELECTED_COLOR = "#2563eb";
const ERROR_COLOR = "#dc2626";

function formatTco2e(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-- tCO2e";
  return `${value.toLocaleString("id-ID", { maximumFractionDigits: 2 })} tCO2e`;
}

/** Primitive geometry per node -- see module docstring: no modelled asset
 * is required for this to be a usable input surface. */
function NodeGeometry({ node }: { node: NodeId }) {
  switch (node) {
    case "stockpile":
      return <coneGeometry args={[1.4, 2, 24]} />;
    case "dryer":
      return <cylinderGeometry args={[0.9, 0.9, 2.4, 24]} />;
    case "kiln":
      return <cylinderGeometry args={[0.7, 0.7, 3.2, 24]} />;
    case "eaf":
      return <boxGeometry args={[2, 2, 2]} />;
    case "pltu":
      return <boxGeometry args={[1.6, 2.6, 1.6]} />;
  }
}

function NodeMesh({
  node,
  selected,
  errorMessage,
  badgeValue,
  onSelect,
}: {
  node: NodeId;
  selected: boolean;
  errorMessage?: string;
  badgeValue: number | null | undefined;
  onSelect: (node: NodeId) => void;
}) {
  const color = errorMessage ? ERROR_COLOR : selected ? SELECTED_COLOR : BASE_COLOR[node];
  // The kiln is a rotary drum -- lay its cylinder on its side to read as
  // one, rather than standing upright like the dryer.
  const rotation: [number, number, number] = node === "kiln" ? [0, 0, Math.PI / 2] : [0, 0, 0];

  return (
    <group position={[NODE_X[node], 0, 0]}>
      <mesh
        rotation={rotation}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(node);
        }}
      >
        <NodeGeometry node={node} />
        <meshStandardMaterial color={color} />
      </mesh>
      <Html center position={[0, 2.2, 0]} distanceFactor={14}>
        <div
          data-testid={`node-label-${node}`}
          onClick={() => onSelect(node)}
          className={`flex cursor-pointer flex-col items-center rounded px-2 py-1 text-center text-xs font-medium shadow ${
            errorMessage
              ? "bg-red-600 text-white"
              : "bg-white/90 text-black dark:bg-zinc-900/90 dark:text-zinc-50"
          }`}
        >
          <span>{NODE_LABELS[node]}</span>
          <span className="font-mono">{formatTco2e(badgeValue)}</span>
          {errorMessage && <span className="max-w-[10rem]">{errorMessage}</span>}
        </div>
      </Html>
    </group>
  );
}

export default function Scene({ selectedNode, onSelectNode, badges, nodeErrors }: SceneProps) {
  return (
    <Canvas camera={{ position: [0, 6, 16], fov: 45 }}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 12, 8]} intensity={1.1} />
      {NODE_ORDER.map((node) => (
        <NodeMesh
          key={node}
          node={node}
          selected={selectedNode === node}
          errorMessage={nodeErrors[node]}
          badgeValue={badges[node]}
          onSelect={onSelectNode}
        />
      ))}
      <OrbitControls enablePan={false} minDistance={8} maxDistance={30} />
    </Canvas>
  );
}
