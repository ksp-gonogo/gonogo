import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Button,
  Card,
  Grid,
  Meter,
  Stack,
  Tag,
} from "@ksp-gonogo/ui-kit";
import {
  intentResult,
  stepBadge,
  stepName,
  stepTarget,
  triggerText,
  wholeFigure,
} from "./format";
import type { PlanLive, ScoredStep } from "./scoring";

/**
 * One step of a plan as a card: its number, name, target and state, with its
 * intents inside it. The current step also shows its progress. A step whose
 * intent is late is drawn with a caution edge, and one that fails with a nogo
 * edge.
 */
export function StepCard({
  index,
  scored,
  current,
  live,
  onEdit,
  planning = false,
}: {
  index: number;
  /** Before flight: an intent shows no live value, since there is no flight to measure. */
  planning?: boolean;
  /** Makes the step's name a control that opens its editor. */
  onEdit?: () => void;
  scored: ScoredStep;
  current: boolean;
  live: PlanLive;
}) {
  const { step, status, intents, flagged } = scored;
  const badge = stepBadge(status, scored.runs);
  const failed = status.kind === "short" || status.kind === "likely-to-fail";
  const tone = failed
    ? "nogo"
    : flagged
      ? "caution"
      : current
        ? "go"
        : undefined;
  return (
    <Card
      tone={tone}
      dimmed={status.kind === "done"}
      data-current={current || undefined}
      data-flagged={flagged || undefined}
      data-failed={failed || undefined}
    >
      <Stack gap="related-dense">
        <Grid
          cols="auto auto 1fr auto auto auto"
          gap="related-compact"
          align="center"
        >
          <span>{index + 1}</span>
          {onEdit ? (
            <Button variant="text" onClick={onEdit}>
              {stepName(step)}
            </Button>
          ) : (
            <span>{stepName(step)}</span>
          )}
          <span>{stepTarget(step)}</span>
          {current && step.script ? (
            <Tag label={step.script.name} name />
          ) : (
            <span />
          )}
          <span>{badge?.figure}</span>
          {badge ? (
            <Badge size="sm" tone={badge.tone}>
              {badge.label}
            </Badge>
          ) : (
            <span />
          )}
        </Grid>
        {current ? <StepProgress step={step} live={live} /> : null}
        {planning && scored.has !== undefined && step.needsDv !== undefined ? (
          <Meter
            label="Δv"
            layout="row"
            value={scored.has.max(0).min(value("m/s", step.needsDv))}
            capacity={value("m/s", step.needsDv)}
            valueLabel={`${wholeFigure(scored.has.max(0))} of ${wholeFigure(value("m/s", step.needsDv))}`}
          />
        ) : null}
        {intents.map(({ intent, status: is }) => {
          const result = planning
            ? undefined
            : intentResult(intent.trigger, is, live);
          return (
            <Grid
              key={intent.group}
              cols="auto 1fr auto auto auto"
              gap="related-compact"
              align="center"
            >
              <Tag label={`AG${intent.group}`} name />
              <span>{intent.label}</span>
              <span>{triggerText(intent.trigger)}</span>
              <span>{result?.text}</span>
              {result?.late ? (
                <Badge size="sm" tone="caution">
                  Late
                </Badge>
              ) : (
                <span />
              )}
            </Grid>
          );
        })}
      </Stack>
    </Card>
  );
}

function StepProgress({
  step,
  live,
}: {
  step: ScoredStep["step"];
  live: PlanLive;
}) {
  if (step.kind !== "reach-orbit") return null;
  const target =
    typeof step.inputs.periapsis === "number"
      ? step.inputs.periapsis
      : undefined;
  if (target === undefined) return null;
  const capacity = value("m", target);
  return (
    <Stack gap="related-dense">
      <Meter
        label="Apoapsis"
        layout="row"
        value={live.apoapsis === undefined ? null : live.apoapsis.max(0)}
        capacity={capacity}
        valueLabel={
          live.apoapsis === undefined
            ? undefined
            : `${wholeFigure(live.apoapsis)} of ${wholeFigure(capacity)}`
        }
      />
      <Meter
        label="Periapsis"
        layout="row"
        value={live.periapsis === undefined ? null : live.periapsis.max(0)}
        capacity={capacity}
        valueLabel={
          live.periapsis === undefined
            ? undefined
            : `${wholeFigure(live.periapsis)} of ${wholeFigure(capacity)}`
        }
      />
    </Stack>
  );
}
