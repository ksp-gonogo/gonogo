/**
 * AltitudeRail: the altimeter as a full-height rail down one edge of the
 * landing widget, rather than a strip crammed into the middle of the flight
 * picture. It is the spatial spine of the instrument: AGL falling toward the
 * ground line at the bottom, the suicide-burn ignition band shaded as a hot
 * zone the pointer descends into, and the ignition cue pinned beneath it.
 *
 * Presentational: `aglMeters` / `ignitionAltitude` / `suicideBurnCountdown`
 * are derived upstream by `solveSuicideBurn` and passed in. All nullable, the
 * rail renders a safe empty scale before data arrives.
 */

import { Tape, Value } from "@ksp-gonogo/ui-kit";

export interface AltitudeRailProps {
  /** Height of the vessel's lowest point above terrain, metres. */
  aglMeters: number | null;
  /** AGL at which the suicide burn must begin, metres. */
  ignitionAltitude: number | null;
  /** Seconds to the latest ignition. */
  suicideBurnCountdown: number | null;
}

/** Round up to a "nice" 1/2/5 x 10^n ceiling for the ladder's top of scale. */
function niceCeil(x: number): number {
  if (!(x > 0)) return 100;
  const pow = 10 ** Math.floor(Math.log10(x));
  const n = x / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

export function AltitudeRail({
  aglMeters,
  ignitionAltitude,
  suicideBurnCountdown,
}: Readonly<AltitudeRailProps>) {
  const agl = aglMeters ?? 0;
  const ignition =
    ignitionAltitude != null && ignitionAltitude > 0 ? ignitionAltitude : null;
  const maxScale = niceCeil(Math.max(agl, ignition ?? 0, 1) * 1.1);

  // The hot band: from the ground up to the ignition altitude, the region in
  // which the burn must already have started.
  const zones =
    ignition != null
      ? [
          {
            from: 0,
            to: ignition,
            color: "var(--color-status-nogo-fg)",
            label: "burn",
          },
        ]
      : undefined;

  const near = suicideBurnCountdown != null && suicideBurnCountdown <= 5;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        height: "100%",
        // Root-relative on purpose, so the rail's internal rhythm tracks the
        // browser font size. The px spacing ladder would freeze it, which is
        // an accessibility regression rather than a cleanup.
        gap: "0.25rem",
        minWidth: 0,
      }}
    >
      <div style={{ flex: 1, minHeight: 0, width: "100%" }}>
        <Tape
          fillHeight
          labelSide="right"
          width={64}
          value={agl}
          min={0}
          max={maxScale}
          unit="m"
          tickStep={maxScale / 4}
          groundLine={0}
          zones={zones}
          ariaLabel="Altitude above terrain"
        />
      </div>
      {/* The scale reads inboard now (labelSide="right"), so the cue sits with
          the numbers rather than against the panel border. Panel.Body supplies
          the outer inset, so this needs none of its own. */}
      <div style={{ alignSelf: "stretch" }}>
        <Value tone={near ? "accent" : "muted"} size="xs">
          {suicideBurnCountdown == null
            ? "no burn"
            : suicideBurnCountdown <= 0
              ? "past ignition"
              : `ignite in ${Math.ceil(suicideBurnCountdown)}s`}
        </Value>
      </div>
    </div>
  );
}
