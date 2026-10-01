import { datedFrom, value } from "@ksp-gonogo/sitrep-sdk";
import { Sparkline } from "@ksp-gonogo/ui";
import {
  Badge,
  Countdown,
  FAINT_TEXT_STYLE,
  Grid,
  NULL_DISPLAY,
  ReadoutCaption,
  Text,
} from "@ksp-gonogo/ui-kit";
import { Dv, Metres, Mps, StackedField } from "./readouts";
import type { LandingModel } from "./useLandingModel";

function Affordable({
  noLandingVector,
  affordable,
}: Readonly<Pick<LandingModel, "noLandingVector" | "affordable">>) {
  // A green "yes" would contradict the ABORT above, since fuel is not the wall.
  if (noLandingVector) return <Text level="muted">n/a · no path</Text>;
  if (affordable == null) return <Text level="muted">{NULL_DISPLAY}</Text>;
  return (
    <Badge tone={affordable ? "go" : "nogo"} size="sm">
      {affordable ? "yes" : "insufficient dV"}
    </Badge>
  );
}

/**
 * The burn and touchdown readouts: once landed, how soft and how much fuel is left; on a vacuum solve, the burn it needs.
 * `minColWidth` makes this one column in the narrow stack and a row full-width under the plots.
 */
export function SolutionReadouts({
  model,
  showTrend,
}: Readonly<{ model: LandingModel; showTrend: boolean }>) {
  const {
    landed,
    board,
    flight,
    solution,
    availableDv,
    requiredDv,
    noLandingVector,
    affordable,
    targetRange,
    descentHistory,
    solveCurrency,
  } = model;

  if (landed) {
    return (
      <Grid minColWidth="130px" gap="related-dense">
        <StackedField label="Touchdown speed">
          {
            <Mps
              v={flight?.surfaceSpeed ?? solution.horizontalSpeed}
              from={solveCurrency}
            />
          }
        </StackedField>
        <StackedField label="Fuel remaining">
          {<Dv v={availableDv} from={solveCurrency} />}
        </StackedField>
      </Grid>
    );
  }

  if (board !== "vacuum-solved") return null;

  return (
    // Under NO LANDING VECTOR every number here is moot, so the grid recedes rather than reading as reassurance against the ABORT.
    <div style={noLandingVector ? FAINT_TEXT_STYLE : undefined}>
      <Grid minColWidth="130px" gap="related-dense">
        <StackedField label="Burn dV">
          {<Dv v={requiredDv} from={solveCurrency} />}
        </StackedField>
        <StackedField label="Burn duration">
          {solution.burnDuration == null ? (
            NULL_DISPLAY
          ) : (
            <Countdown
              value={datedFrom(
                solveCurrency,
                value("s", solution.burnDuration),
              )}
              precise
            />
          )}
        </StackedField>
        <StackedField label="Available dV">
          {<Dv v={availableDv} from={solveCurrency} />}
        </StackedField>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "start",
          }}
        >
          <ReadoutCaption>Affordable</ReadoutCaption>
          <Affordable
            noLandingVector={noLandingVector}
            affordable={affordable}
          />
        </div>
        <StackedField label="Touchdown (coast)">
          {<Mps v={solution.speedAtImpact} from={solveCurrency} />}
        </StackedField>
        <StackedField label="Touchdown (burn now)">
          {solution.bestSpeedAtImpact == null ? (
            NULL_DISPLAY
          ) : (
            <Mps v={solution.bestSpeedAtImpact} from={solveCurrency} />
          )}
        </StackedField>
        <StackedField label="Impact in">
          {solution.timeToImpact == null ? (
            NULL_DISPLAY
          ) : (
            <Countdown
              value={datedFrom(
                solveCurrency,
                value("s", solution.timeToImpact),
              )}
              precise
            />
          )}
        </StackedField>
        {targetRange !== undefined && (
          <StackedField label="Target range">
            {<Metres m={targetRange} from={solveCurrency} />}
          </StackedField>
        )}
        {showTrend && descentHistory.length >= 2 && (
          // The trend carries no words, so it is the one mark a moot grid may dim by opacity.
          <div style={noLandingVector ? { opacity: 0.5 } : undefined}>
            <Sparkline
              values={descentHistory}
              width={120}
              height={24}
              ariaLabel="Descent-rate trend"
            />
          </div>
        )}
      </Grid>
    </div>
  );
}
