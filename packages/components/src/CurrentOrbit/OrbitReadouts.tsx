import {
  type apsidesExist,
  frameCaveat,
  type Reading,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Countdown,
  Grid,
  NULL_DISPLAY,
  Unit,
  type UnitValue,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { FrameCaveat, OrbitLabel, OrbitValue } from "./OrbitCells";

type Apsides = ReturnType<typeof apsidesExist>;
type Apsis = "Ap" | "Pe";

const APSIS_NAME: Record<Apsis, string> = {
  Ap: "apoapsis",
  Pe: "periapsis",
};

interface ApsisCellProps {
  apsis: Apsis;
  apsides: Apsides;
  noApsidesHere: boolean;
  children: ReactNode;
}

/** A value measured from an apsis, or words saying the operator's view frame has no such apsis. */
function ApsisCell({
  apsis,
  apsides,
  noApsidesHere,
  children,
}: ApsisCellProps): ReactNode {
  if (!noApsidesHere) return children;
  return (
    <FrameCaveat title={frameCaveat(apsides, APSIS_NAME[apsis])}>
      {`no ${apsis} here`}
    </FrameCaveat>
  );
}

/** One readout: a label and its value, aligned on the text baseline. */
function Pair({
  columns,
  gap,
  children,
}: {
  columns: string;
  gap: string;
  children: ReactNode;
}) {
  return (
    <Grid cols={columns} align="baseline" style={{ gap }}>
      {children}
    </Grid>
  );
}

export interface OrbitReadoutGridProps {
  tight: boolean;
  narrow: boolean;
  showInclinationRow: boolean;
  showApProgressRows: boolean;
  showEccentricityRows: boolean;
  apsides: Apsides;
  noApsidesHere: boolean;
  apoapsisAltitude: number | undefined;
  periapsisAltitude: number | undefined;
  timeToAp: Reading<Value<"s">> | undefined;
  timeToPe: Reading<Value<"s">> | undefined;
  inclination: UnitValue | undefined;
  eccentricity: UnitValue | undefined;
  period: number | undefined;
}

export function OrbitReadoutGrid({
  tight,
  narrow,
  showInclinationRow,
  showApProgressRows,
  showEccentricityRows,
  apsides,
  noApsidesHere,
  apoapsisAltitude,
  periapsisAltitude,
  timeToAp,
  timeToPe,
  inclination,
  eccentricity,
  period,
}: Readonly<OrbitReadoutGridProps>) {
  const cell = { apsides, noApsidesHere };
  const pairColumns = tight ? "2.2em minmax(0, 1fr)" : "3em minmax(0, 1fr)";
  const pairGap = tight
    ? "var(--gap-label-value-tight)"
    : "var(--gap-label-value)";
  return (
    // Each readout is a label and its value, and the pairs flow into as many columns as the room allows, so a wide aside reads in a few rows.
    <Grid
      minColWidth={tight ? "6.5rem" : "8rem"}
      align="baseline"
      rowGap="readout-row"
      gap="section-compact"
      style={{ alignContent: "start", width: "100%" }}
    >
      <Pair columns={pairColumns} gap={pairGap}>
        <OrbitLabel>Ap</OrbitLabel>
        <OrbitValue accent="ap" tight={tight} narrow={narrow}>
          <ApsisCell apsis="Ap" {...cell}>
            {apoapsisAltitude === undefined ? (
              NULL_DISPLAY
            ) : (
              <Unit value={value("m", apoapsisAltitude)} />
            )}
          </ApsisCell>
        </OrbitValue>
      </Pair>

      <Pair columns={pairColumns} gap={pairGap}>
        <OrbitLabel>Pe</OrbitLabel>
        {/* A sub-surface periapsis means impact, so it takes the alert colour. */}
        <OrbitValue
          accent={
            periapsisAltitude !== undefined && periapsisAltitude < 0
              ? "alert"
              : "pe"
          }
          tight={tight}
          narrow={narrow}
        >
          <ApsisCell apsis="Pe" {...cell}>
            {periapsisAltitude === undefined ? (
              NULL_DISPLAY
            ) : (
              <Unit value={value("m", periapsisAltitude)} />
            )}
          </ApsisCell>
        </OrbitValue>
      </Pair>

      {showApProgressRows && (
        <>
          <Pair columns={pairColumns} gap={pairGap}>
            <OrbitLabel>t-Ap</OrbitLabel>
            <OrbitValue accent="ap" tight={tight} narrow={narrow}>
              {/* A countdown to an apsis that does not exist would read as an imminent event. */}
              <ApsisCell apsis="Ap" {...cell}>
                {timeToAp === undefined ? (
                  NULL_DISPLAY
                ) : (
                  <Countdown value={timeToAp} />
                )}
              </ApsisCell>
            </OrbitValue>
          </Pair>

          <Pair columns={pairColumns} gap={pairGap}>
            <OrbitLabel>t-Pe</OrbitLabel>
            <OrbitValue accent="pe" tight={tight} narrow={narrow}>
              <ApsisCell apsis="Pe" {...cell}>
                {timeToPe === undefined ? (
                  NULL_DISPLAY
                ) : (
                  <Countdown value={timeToPe} />
                )}
              </ApsisCell>
            </OrbitValue>
          </Pair>
        </>
      )}

      {showInclinationRow && (
        <Pair columns={pairColumns} gap={pairGap}>
          <OrbitLabel>Inc</OrbitLabel>
          <OrbitValue tight={tight} narrow={narrow}>
            {inclination === undefined ? (
              NULL_DISPLAY
            ) : (
              <Unit value={inclination} decimals={1} />
            )}
          </OrbitValue>
        </Pair>
      )}

      {showEccentricityRows && (
        <>
          <Pair columns={pairColumns} gap={pairGap}>
            <OrbitLabel>Ecc</OrbitLabel>
            <OrbitValue tight={tight} narrow={narrow}>
              {eccentricity === undefined ? (
                NULL_DISPLAY
              ) : (
                <Unit value={eccentricity} decimals={4} />
              )}
            </OrbitValue>
          </Pair>

          <Pair columns={pairColumns} gap={pairGap}>
            <OrbitLabel>T</OrbitLabel>
            <OrbitValue tight={tight} narrow={narrow}>
              {period === undefined ? (
                NULL_DISPLAY
              ) : (
                <Unit value={value("s", period)} />
              )}
            </OrbitValue>
          </Pair>
        </>
      )}
    </Grid>
  );
}
