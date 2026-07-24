/**
 * DescentScope — the real-time flight picture for the landing widget: a
 * composed instrument, not a list of numbers.
 *
 * - Altitude ladder (ui-kit Tape): AGL falling toward a ground line, with the
 *   suicide-burn region shaded as a hot band the pointer descends into.
 * - Velocity vector (bespoke SVG): vertical descent vs horizontal drift as a 2D
 *   vector, so "coming down straight" vs "sliding sideways" reads at a glance.
 *   Magnitude-only for now (surface-velocity direction is not on the wire yet);
 *   the compass bearing arrives with the reticle's predicted-point drift.
 * - TWR gauge (ui-kit Gauge): can-I-even-stop, red below 1, green past 1.5.
 *
 * Purely presentational: every value is derived upstream from `solveSuicideBurn`
 * and passed in. All inputs are nullable — the scope renders a safe empty frame
 * before data arrives.
 */

import { Gauge } from "@ksp-gonogo/ui";
import { Cluster, Stack, Tape, Value } from "@ksp-gonogo/ui-kit";

export interface DescentScopeProps {
  /** Height of the vessel's lowest point above terrain, metres. */
  aglMeters: number | null;
  /** Descent rate, m/s (down-positive). */
  verticalSpeed: number | null;
  /** Horizontal component of surface velocity, m/s. */
  horizontalSpeed: number | null;
  /** AGL at which the suicide burn must begin, metres. */
  ignitionAltitude: number | null;
  /** Seconds to the latest ignition. */
  suicideBurnCountdown: number | null;
  /** Thrust-to-weight ratio (maxAccel / local gravity). */
  twr: number | null;
  /** True when AGL is the centre-of-mass radar altitude, not the lowest point. */
  usingComDatum: boolean;
}

/** Round up to a "nice" 1/2/5 x 10^n ceiling for the ladder's top of scale. */
function niceCeil(x: number): number {
  if (!(x > 0)) return 100;
  const pow = 10 ** Math.floor(Math.log10(x));
  const n = x / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function fmtSpeed(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v)} m/s`;
}

export function DescentScope({
  aglMeters,
  verticalSpeed,
  horizontalSpeed,
  ignitionAltitude,
  suicideBurnCountdown,
  twr,
  usingComDatum,
}: Readonly<DescentScopeProps>) {
  const agl = aglMeters ?? 0;
  const ignition =
    ignitionAltitude != null && ignitionAltitude > 0 ? ignitionAltitude : null;
  const maxScale = niceCeil(Math.max(agl, ignition ?? 0, 1) * 1.1);

  // The hot band: from the ground up to the ignition altitude — the region in
  // which the burn must already have started.
  const zones =
    ignition != null
      ? [
          {
            from: 0,
            to: ignition,
            color: "var(--color-alert-fg, #e0533d)",
            label: "burn",
          },
        ]
      : undefined;

  const near = suicideBurnCountdown != null && suicideBurnCountdown <= 5;

  return (
    <Cluster gap="md">
      <Stack gap="xs">
        <Tape
          value={agl}
          min={0}
          max={maxScale}
          unit="m"
          tickStep={maxScale / 4}
          groundLine={0}
          zones={zones}
          ariaLabel="Altitude above terrain"
        />
        <Value tone={near ? "accent" : "muted"} size="xs">
          {suicideBurnCountdown == null
            ? "no burn"
            : suicideBurnCountdown <= 0
              ? "past ignition"
              : `ignite in ${Math.ceil(suicideBurnCountdown)}s`}
        </Value>
      </Stack>

      <Stack gap="sm">
        <VelocityVector vertical={verticalSpeed} horizontal={horizontalSpeed} />
        <Gauge
          value={twr ?? 0}
          min={0}
          max={3}
          width={110}
          height={70}
          zones={[
            { from: 0, to: 1, color: "var(--color-alert-fg, #e0533d)" },
            { from: 1, to: 1.5, color: "var(--color-warn-fg, #d9a441)" },
            { from: 1.5, to: 3, color: "var(--color-go-fg, #4bd07a)" },
          ]}
          valueLabel={twr == null ? "—" : twr.toFixed(2)}
          unitLabel="TWR"
          ariaLabel={`TWR ${twr == null ? "unknown" : twr.toFixed(2)}`}
        />
        {usingComDatum && (
          <Value tone="muted" size="xs">
            centre-of-mass altitude (lowest-point datum unavailable)
          </Value>
        )}
      </Stack>
    </Cluster>
  );
}

/**
 * A compact 2D vector: descent down the y-axis, drift along the x-axis, plus the
 * resultant. Scaled so the larger component fills the box. The accessible name
 * carries both numbers so the picture is never the sole carrier.
 */
function VelocityVector({
  vertical,
  horizontal,
}: {
  vertical: number | null;
  horizontal: number | null;
}) {
  const W = 92;
  const H = 92;
  const ox = 16;
  const oy = 12;
  const maxLen = 64;
  const vDown = vertical != null && vertical > 0 ? vertical : 0;
  const vHor = horizontal != null && horizontal > 0 ? horizontal : 0;
  const scale = Math.max(vDown, vHor, 1);
  const dy = (vDown / scale) * maxLen;
  const dx = (vHor / scale) * maxLen;

  const label = `Descent ${fmtSpeed(vertical)}, drift ${fmtSpeed(horizontal)}`;

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      style={{ display: "block", maxWidth: "100%", height: "auto" }}
    >
      <title>{label}</title>
      {/* axes */}
      <line
        x1={ox}
        y1={oy}
        x2={ox}
        y2={H - 8}
        stroke="var(--color-border-subtle)"
        strokeWidth={1}
      />
      <line
        x1={ox}
        y1={oy}
        x2={W - 8}
        y2={oy}
        stroke="var(--color-border-subtle)"
        strokeWidth={1}
      />
      {/* vertical (descent) */}
      <line
        x1={ox}
        y1={oy}
        x2={ox}
        y2={oy + dy}
        stroke="var(--color-accent-fg)"
        strokeWidth={2}
      />
      {/* horizontal (drift) */}
      <line
        x1={ox}
        y1={oy}
        x2={ox + dx}
        y2={oy}
        stroke="var(--color-warn-fg, #d9a441)"
        strokeWidth={2}
      />
      {/* resultant */}
      <line
        x1={ox}
        y1={oy}
        x2={ox + dx}
        y2={oy + dy}
        stroke="var(--color-text-primary)"
        strokeWidth={1.5}
        strokeDasharray="3 2"
      />
      <text
        x={ox + 3}
        y={oy + dy - 2}
        fontSize={8}
        fill="var(--color-accent-fg)"
      >
        {fmtSpeed(vertical)}
      </text>
      <text
        x={ox + dx - 2}
        y={oy - 3}
        fontSize={8}
        textAnchor="end"
        fill="var(--color-warn-fg, #d9a441)"
      >
        {fmtSpeed(horizontal)}
      </text>
    </svg>
  );
}
