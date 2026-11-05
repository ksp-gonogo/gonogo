import type { CrashReportOfEnding } from "@ksp-gonogo/core";
import type { CSSProperties } from "react";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * What the crash report says was lost, as separate facts: parts and kerbals.
 * A list the report did not send counts as nothing lost to name.
 */
function lossesOf(crash: CrashReportOfEnding): string[] {
  const lost = Array.isArray(crash.partsLost) ? crash.partsLost.length : 0;
  const killed = Array.isArray(crash.kerbalsKilled)
    ? crash.kerbalsKilled.length
    : 0;
  return [
    lost > 0 ? plural(lost, "part", "parts") + " lost" : "",
    killed > 0 ? plural(killed, "kerbal", "kerbals") + " lost" : "",
  ].filter(Boolean);
}

/**
 * The craft the Ship Map showed, broken into drifting fragments with a scorch
 * mark under them, and the report of what was lost. Shown by the Ship Map in
 * place of its diagram when the crash report is for a craft the map never drew,
 * so there is no topology to mark the lost parts on.
 */
export function DestroyedCraft({
  crash,
}: Readonly<{ crash: CrashReportOfEnding }>) {
  const name = typeof crash.vesselName === "string" ? crash.vesselName : "";
  return (
    <div style={WRAP}>
      <svg
        viewBox="0 0 120 80"
        width="120"
        height="80"
        aria-hidden="true"
        style={{ color: "var(--color-nogo-mark)" }}
      >
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        >
          <path d="M20 66 L34 58 L30 46 L18 50 Z" />
          <path
            d="M46 44 L60 30 L68 40 L58 54 Z"
            transform="rotate(-18 57 42)"
          />
          <path
            d="M78 24 L88 12 L96 22 L88 32 Z"
            transform="rotate(24 87 22)"
          />
          <path d="M84 60 L100 56 L104 66 L90 70 Z" />
          <path d="M6 74 H114" strokeDasharray="10 6" opacity="0.5" />
        </g>
        <g fill="currentColor" opacity="0.6">
          <circle cx="40" cy="30" r="1.8" />
          <circle cx="70" cy="14" r="1.4" />
          <circle cx="104" cy="40" r="1.6" />
          <circle cx="14" cy="34" r="1.2" />
        </g>
      </svg>
      {name && <div style={NAME}>{name}</div>}
      {lossesOf(crash).map((loss) => (
        <div key={loss} style={LOSS}>
          {loss}
        </div>
      ))}
    </div>
  );
}

const WRAP: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--gap-related)",
  padding: "var(--inset-tile-message)",
  textAlign: "center",
};

const NAME: CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "var(--font-size-compact)",
};

const LOSS: CSSProperties = {
  color: "var(--color-text-dim)",
  fontSize: "var(--font-size-compact)",
};
