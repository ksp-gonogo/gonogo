import { PanZoomViewport, usePanZoom } from "@ksp-gonogo/ui-kit";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { withGonogoFrame } from "../../frame";

const RINGS = [40, 80, 120, 160];

/** A simple orbit diagram drawn in its own units, moved by the camera the hook holds. */
function Diagram() {
  const panZoom = usePanZoom({ minZoom: 0.5, maxZoom: 8 });
  const { zoom, panX, panY } = panZoom.camera;
  return (
    <div
      style={{
        width: 480,
        height: 320,
        border: "1px solid var(--color-border-subtle)",
        overflow: "hidden",
      }}
    >
      <PanZoomViewport panZoom={panZoom} label="Orbit diagram">
        <svg
          width="100%"
          height="100%"
          role="img"
          aria-label="Concentric orbits around a body"
        >
          <g
            transform={`translate(240 160) scale(${zoom}) translate(${-panX} ${-panY})`}
          >
            {RINGS.map((r) => (
              <circle
                key={r}
                r={r}
                fill="none"
                stroke="var(--color-border-strong)"
                strokeWidth={1 / zoom}
              />
            ))}
            <circle r={12} fill="var(--color-text-primary)" />
            <circle cx={120} cy={0} r={5} fill="var(--color-text-primary)" />
          </g>
        </svg>
      </PanZoomViewport>
    </div>
  );
}

const meta = {
  title: "ui-kit/PanZoomViewport",
  component: Diagram,
  decorators: [withGonogoFrame],
} satisfies Meta<typeof Diagram>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Drag to pan, pinch or Ctrl plus wheel to zoom; a plain wheel turn zooms only
 * when it began inside the diagram, so the page keeps scrolling past it. Tab to
 * the diagram for the arrow, plus, minus and 0 keys and their note.
 */
export const Orbits: Story = {
  args: {},
};
