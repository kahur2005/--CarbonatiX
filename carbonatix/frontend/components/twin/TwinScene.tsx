import { Component, Suspense, useMemo, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html, useGLTF, useProgress, Grid } from "@react-three/drei";
import * as THREE from "three";
import { Box } from "lucide-react";

/* ------------------------------------------------------------------ *
 *  TwinScene — real three.js viewer for the 3D Digital Twin page.
 *  Loads the site GLB, normalizes it to a ~10-unit footprint sitting
 *  on y=0, and anchors clickable hotspot markers to fixed positions.
 * ------------------------------------------------------------------ */

const MODEL_URL = "/models/thermal_power_plant__cooling_tower.glb";

// Colors handed down from App.tsx's active theme palette `C`.
export type TwinPalette = {
  sceneA: string;
  sceneB: string;
  sceneC: string;
  cyan: string;
  green: string;
  border: string;
  dimText: string;
  muted: string;
  text: string;
  glbLabelBg: string;
};

export type TwinNode = { id: string; label: string };

// Hand-tuned marker positions in normalized model space
// (model scaled so max dimension = 10, bottom at y = 0, centered on x/z).
const HOTSPOT_POSITIONS: Record<string, [number, number, number]> = {
  cooling: [3.2, 3.6, 2.4],
  kiln: [-2.4, 1.4, 1.6],
  furnace: [-0.4, 2.4, -1.8],
  dryer: [1.0, 0.9, 3.2],
};

function NormalizedModel() {
  const { scene } = useGLTF(MODEL_URL);
  const { scale, offset } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const s = 10 / maxDim;
    // Bottom sits on y=0, centered at the origin on x/z.
    return {
      scale: s,
      offset: [-center.x * s, -box.min.y * s, -center.z * s] as [number, number, number],
    };
  }, [scene]);

  return (
    <group position={offset} scale={scale}>
      <primitive object={scene} />
    </group>
  );
}

useGLTF.preload(MODEL_URL);

function Hotspot({
  position,
  label,
  active,
  onClick,
  colors,
}: {
  position: [number, number, number];
  label: string;
  active: boolean;
  onClick: () => void;
  colors: TwinPalette;
}) {
  const size = active ? 20 : 14;
  return (
    <Html position={position} center zIndexRange={[40, 0]} style={{ pointerEvents: "none" }}>
      <button
        onClick={onClick}
        className="relative flex items-center justify-center"
        style={{ pointerEvents: "auto", background: "none", border: "none", cursor: "pointer" }}
      >
        <span
          className="absolute rounded-full animate-ping"
          style={{ width: size + 14, height: size + 14, background: `${colors.cyan}40` }}
        />
        <span
          className="relative rounded-full"
          style={{
            width: size,
            height: size,
            background: active ? colors.cyan : `${colors.cyan}55`,
            border: `2px solid ${colors.cyan}`,
            boxShadow: `0 0 12px ${colors.cyan}`,
          }}
        />
        <span
          className="absolute whitespace-nowrap text-[9px] px-1.5 py-0.5 rounded"
          style={{
            top: size + 8,
            color: colors.text,
            background: colors.glbLabelBg,
            border: `1px solid ${colors.cyan}44`,
            fontFamily: "var(--font-mono), monospace",
          }}
        >
          {label}
        </span>
      </button>
    </Html>
  );
}

function LoaderOverlay({ colors }: { colors: TwinPalette }) {
  const { progress, active } = useProgress();
  if (!active && progress >= 100) return null;
  const pct = Math.round(progress);
  return (
    <div
      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3"
      style={{
        background: `radial-gradient(circle at 50% 30%, ${colors.sceneA} 0%, ${colors.sceneB} 60%, ${colors.sceneC} 100%)`,
      }}
    >
      <div
        className="flex items-center gap-2 px-4 py-2 rounded-lg"
        style={{ background: colors.glbLabelBg, border: `1px solid ${colors.border}` }}
      >
        <Box size={14} color={colors.cyan} />
        <span
          className="text-[11px]"
          style={{ color: colors.dimText, fontFamily: "var(--font-mono), monospace" }}
        >
          Loading thermal_power_plant__cooling_tower.glb — {pct}%
        </span>
      </div>
      <div className="w-64 h-1.5 rounded-full overflow-hidden" style={{ background: colors.border }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: colors.cyan, boxShadow: `0 0 8px ${colors.cyan}` }}
        />
      </div>
    </div>
  );
}

class SceneErrorBoundary extends Component<
  { colors: TwinPalette; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    const { colors } = this.props;
    if (this.state.error) {
      return (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2"
          style={{
            background: `radial-gradient(circle at 50% 30%, ${colors.sceneA} 0%, ${colors.sceneB} 60%, ${colors.sceneC} 100%)`,
          }}
        >
          <div
            className="flex flex-col items-center gap-2 px-6 py-4 rounded-lg"
            style={{ background: colors.glbLabelBg, border: `1px solid ${colors.border}` }}
          >
            <Box size={20} color={colors.muted} />
            <span className="text-[12px] font-bold" style={{ color: colors.text }}>
              Failed to load 3D model
            </span>
            <span
              className="text-[10px]"
              style={{ color: colors.muted, fontFamily: "var(--font-mono), monospace" }}
            >
              {this.state.error.message || "Check that public/models contains the .glb file"}
            </span>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function TwinScene({
  colors,
  nodes,
  selectedId,
  onSelect,
}: {
  colors: TwinPalette;
  nodes: TwinNode[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="absolute inset-0">
      <SceneErrorBoundary colors={colors}>
        <Canvas
          camera={{ position: [12, 8, 14], fov: 45 }}
          dpr={[1, 2]}
          shadows
          style={{
            background: `radial-gradient(circle at 50% 30%, ${colors.sceneA} 0%, ${colors.sceneB} 60%, ${colors.sceneC} 100%)`,
          }}
        >
          <fog attach="fog" args={[colors.sceneB, 40, 90]} />
          <ambientLight intensity={0.55} />
          <hemisphereLight args={["#b8c8e0", "#243040", 0.5]} />
          <directionalLight
            position={[14, 18, 8]}
            intensity={1.4}
            castShadow
            shadow-mapSize={[2048, 2048]}
          />
          <directionalLight position={[-10, 8, -8]} intensity={0.35} />

          <Suspense fallback={null}>
            <NormalizedModel />
            {nodes.map(
              (n) =>
                HOTSPOT_POSITIONS[n.id] && (
                  <Hotspot
                    key={n.id}
                    position={HOTSPOT_POSITIONS[n.id]}
                    label={n.label}
                    active={n.id === selectedId}
                    onClick={() => onSelect(n.id)}
                    colors={colors}
                  />
                ),
            )}
          </Suspense>

          <Grid
            position={[0, -0.01, 0]}
            args={[80, 80]}
            cellSize={1}
            cellThickness={0.4}
            cellColor={colors.cyan}
            sectionSize={5}
            sectionThickness={0.8}
            sectionColor={colors.cyan}
            fadeDistance={55}
            fadeStrength={2}
            infiniteGrid
          />

          <OrbitControls
            makeDefault
            enableDamping
            dampingFactor={0.08}
            target={[0, 2.5, 0]}
            minDistance={4}
            maxDistance={45}
            maxPolarAngle={Math.PI / 2 - 0.04}
          />
        </Canvas>
        <LoaderOverlay colors={colors} />
      </SceneErrorBoundary>
    </div>
  );
}
