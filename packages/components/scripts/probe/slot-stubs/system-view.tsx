import { plantSlot } from "./stub";

/** A dashed ring round the frame body and a label naming it, in the diagram's origin-centred frame. */
plantSlot("system-view.overlay", ({ parentName, width, height, center }) => (
  <svg
    width="100%"
    height="100%"
    viewBox={`${center.x - width / 2} ${center.y - height / 2} ${width} ${height}`}
    preserveAspectRatio="xMidYMid meet"
    role="presentation"
    style={{ position: "absolute", inset: 0 }}
  >
    <circle
      cx={center.x}
      cy={center.y}
      r={28}
      style={{
        fill: "none",
        stroke: "var(--color-status-info-fg)",
        strokeDasharray: "4 3",
      }}
    />
    <text
      x={center.x - width / 2 + 6}
      y={center.y - height / 2 + 14}
      style={{ fill: "var(--color-status-info-fg)", fontSize: 11 }}
    >
      system-view.overlay {parentName}
    </text>
  </svg>
));
