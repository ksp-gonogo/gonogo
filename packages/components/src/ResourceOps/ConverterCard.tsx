import type { IsruConverterEntry, Tone } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Card,
  Grid,
  Inline,
  resourceColor,
  Stack,
  Text,
  Tooltip,
} from "@ksp-gonogo/ui-kit";
import {
  RESOURCE_TABLE_COLS,
  ResourceCells,
  RunStateBadge,
} from "./ProcessCells";
import { ProcessSwitch, type ProcessSwitchHandles } from "./ProcessSwitch";
import { isStarved, reportedStarved } from "./rates";

function converterTone(
  starved: boolean,
  held: boolean,
  running: boolean | null | undefined,
): Tone {
  if (starved) return "warn";
  if (!held && running) return "go";
  return "neutral";
}

function NoFlows() {
  return (
    <Text level="faint" size="sm">
      none
    </Text>
  );
}

export function ConverterCard({
  converter,
  highlighted,
  held: converterHeld,
  switchHandles,
}: Readonly<{
  switchHandles: ProcessSwitchHandles;
  converter: IsruConverterEntry;
  highlighted: boolean;
  /** The recipe still holds; the rates, run state and starved diagnostic do not. */
  held: boolean;
}>) {
  // The game's own figure when it reports one, else every output reading zero; a process with no outputs (a scrubber) is exempt from the fallback.
  const starved = !converterHeld && isStarved(converter);

  // Identity colour, never status: what it makes if it makes anything, else what it consumes.
  const primaryResource =
    converter.outputs[0]?.resource ?? converter.inputs[0]?.resource;

  return (
    <Card
      aria-current={highlighted ? "true" : undefined}
      tone={converterTone(starved, converterHeld, converter.running)}
      identityColor={
        primaryResource ? resourceColor(primaryResource) : undefined
      }
      title={converter.partTitle ?? converter.partId ?? "Converter"}
      titleRight={
        <Inline wrap>
          {converterHeld ? (
            <Badge tone="info">run state held</Badge>
          ) : (
            <RunStateBadge running={converter.running} />
          )}
          {starved && (
            <Tooltip text={converter.shortfall ?? undefined}>
              <Badge tone="warn">no output</Badge>
            </Tooltip>
          )}
        </Inline>
      }
    >
      <Stack>
        {/* Either recipe side can be genuinely empty, and reads as a "none" row. */}
        <Grid cols={RESOURCE_TABLE_COLS} rowGap="readout-row" align="baseline">
          {converter.inputs.length === 0 && <NoFlows />}
          {converter.inputs.map((flow, index) => (
            <ResourceCells
              key={`in-${flow.resource ?? index}`}
              flow={flow}
              direction="in"
              ratesHeld={converterHeld || reportedStarved(converter)}
            />
          ))}
          {converter.outputs.length === 0 && <NoFlows />}
          {converter.outputs.map((flow, index) => (
            <ResourceCells
              key={`out-${flow.resource ?? index}`}
              flow={flow}
              direction="out"
              ratesHeld={converterHeld || reportedStarved(converter)}
            />
          ))}
        </Grid>
        <ProcessSwitch
          handles={switchHandles}
          partId={converter.partId}
          converterName={converter.converterName}
          title={converter.partTitle ?? converter.partId ?? "converter"}
          running={converter.running}
          held={converterHeld}
          extensions={converter.extensions}
        />
      </Stack>
    </Card>
  );
}
