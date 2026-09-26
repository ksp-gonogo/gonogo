interface FuelLineArrowProps {
  from: { x: number; y: number };
  to: { x: number; y: number };
  zoom: number;
}

export function FuelLineArrow({ from, to, zoom }: FuelLineArrowProps) {
  // A stubby pipe in a rotated local frame whose +X points source to target, so the chevrons point along local +X.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

  const thickness = 16 / zoom;
  const stroke = 0.5 / zoom;
  // Chevrons cluster in the middle so the pipe-end joints stay clean; the stride keeps them reading as discrete arrows.
  const chevronW = 7 / zoom;
  const chevronH = 8 / zoom;
  const chevronStride = 12 / zoom;
  const zoneStart = len * 0.18;
  const zoneEnd = len * 0.82;
  const zoneLen = Math.max(0, zoneEnd - zoneStart);
  const count = Math.max(0, Math.floor(zoneLen / chevronStride));
  const actualStride = count > 0 ? zoneLen / count : 0;
  return (
    <g
      data-role="fuel-line"
      pointerEvents="none"
      transform={`translate(${from.x.toFixed(2)} ${from.y.toFixed(2)}) rotate(${angleDeg.toFixed(2)})`}
    >
      <rect
        x={0}
        y={-thickness / 2}
        width={len}
        height={thickness}
        rx={thickness * 0.35}
        fill="var(--color-tag-yellow-fg)"
        stroke="var(--color-tag-yellow-border)"
        strokeWidth={stroke}
        opacity={0.95}
      />
      {Array.from({ length: count }, (_, i) => {
        const cx = zoneStart + (i + 0.5) * actualStride;
        return (
          <polygon
            // biome-ignore lint/suspicious/noArrayIndexKey: chevrons have no stable identity beyond their order along the pipe
            key={i}
            points={`${cx - chevronW * 0.5},${-chevronH * 0.5} ${cx - chevronW * 0.5},${chevronH * 0.5} ${cx + chevronW * 0.5},0`}
            fill="var(--color-tag-blue-bg)"
            opacity={0.9}
          />
        );
      })}
    </g>
  );
}
