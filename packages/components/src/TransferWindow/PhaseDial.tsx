import type { TransferSolution } from "@ksp-gonogo/core";
import { STATUS_LABEL } from "./labels";
import { PhaseDialSvg } from "./styles";

function phaseColor(status: TransferSolution["status"]): string {
  if (status === "go") return "var(--color-accent-fg)";
  if (status === "soon") return "var(--color-warn-mark)";
  return "var(--color-text-dim)";
}

export function PhaseDial({ solution }: { solution: TransferSolution }) {
  const R = 40;
  const cx = 50;
  const cy = 50;
  const point = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return { x: cx + R * Math.cos(a), y: cy - R * Math.sin(a) };
  };
  const cur = point(solution.currentPhaseDeg);
  const ideal = point(solution.idealPhaseDeg);
  const color = phaseColor(solution.status);
  return (
    <PhaseDialSvg
      viewBox="0 0 100 100"
      role="img"
      aria-label={`Current phase ${solution.currentPhaseDeg.toFixed(0)} degrees, ideal ${solution.idealPhaseDeg.toFixed(0)} degrees, ${STATUS_LABEL[solution.status]}`}
    >
      <circle
        cx={cx}
        cy={cy}
        r={R}
        fill="none"
        stroke="var(--color-border-subtle)"
        strokeWidth={1}
      />
      <circle cx={cx + R} cy={cy} r={2.5} fill="var(--color-text-muted)" />
      <line
        x1={cx}
        y1={cy}
        x2={ideal.x}
        y2={ideal.y}
        stroke="var(--color-accent-fg)"
        strokeWidth={1}
        strokeDasharray="3 2"
      />
      <line
        x1={cx}
        y1={cy}
        x2={cur.x}
        y2={cur.y}
        stroke={color}
        strokeWidth={2}
      />
      <circle cx={cur.x} cy={cur.y} r={3} fill={color} />
    </PhaseDialSvg>
  );
}
