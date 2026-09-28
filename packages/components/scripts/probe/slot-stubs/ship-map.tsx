import { plantSlot } from "./stub";

/** A dashed frame around the vessel's fit bounds and a dot on its root part, in the base projection. */
plantSlot("ship-map.overlay", ({ parts, width, height, bounds, baseScale }) => {
  const root = parts[0];
  if (root === undefined) return null;
  const boxW = bounds.w * baseScale;
  const boxH = bounds.h * baseScale;
  const x = width / 2 - boxW / 2;
  const y = height / 2 - boxH / 2;
  return (
    <svg
      width={width}
      height={height}
      role="presentation"
      style={{ position: "absolute", inset: 0 }}
    >
      <rect
        x={x}
        y={y}
        width={boxW}
        height={boxH}
        style={{
          fill: "none",
          stroke: "var(--color-info-mark)",
          strokeDasharray: "4 3",
        }}
      />
      <circle
        cx={width / 2 + (root.lat - bounds.cx) * baseScale}
        cy={height / 2 - (root.axial - bounds.cy) * baseScale}
        r={5}
        style={{ fill: "var(--color-info-mark)" }}
      />
      <text
        x={4}
        y={height - 6}
        style={{ fill: "var(--color-info-text)", fontSize: 11 }}
      >
        ship-map.overlay {root.title}
      </text>
    </svg>
  );
});
