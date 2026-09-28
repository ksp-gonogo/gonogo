import { plantSlot } from "./stub";

/** A dashed ring on periapsis with a label beneath it, drawn in the diagram's body-centric frame. */
plantSlot("orbit-view.overlay", ({ periapsis, argPe, center, scale }) => {
  const unit = scale / 100;
  const rad = (argPe * Math.PI) / 180;
  const peX = center.x + periapsis * Math.cos(rad);
  const peY = center.y - periapsis * Math.sin(rad);
  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`${center.x - scale} ${center.y - scale} ${scale * 2} ${scale * 2}`}
      preserveAspectRatio="xMidYMid meet"
      role="presentation"
      style={{ position: "absolute", inset: 0 }}
    >
      <circle
        cx={peX}
        cy={peY}
        r={unit * 6}
        style={{
          fill: "none",
          stroke: "var(--color-info-mark)",
          strokeWidth: unit * 0.8,
          strokeDasharray: `${unit * 2} ${unit * 1.5}`,
        }}
      />
      {/* Blink clamps font sizes near 10000px, so the label is sized in pixels and scaled into plot units. */}
      <g transform={`translate(${peX} ${peY + unit * 14}) scale(${unit / 2})`}>
        <text
          textAnchor="middle"
          style={{ fill: "var(--color-info-text)", fontSize: 10 }}
        >
          orbit-view.overlay Pe radius {(periapsis / 1000).toFixed(0)} km
        </text>
      </g>
    </svg>
  );
});
