import type { IsruConverterEntry, Tone } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Card,
  Grid,
  Inline,
  resourceColor,
  Stack,
  Text,
} from "@ksp-gonogo/ui-kit";
import {
  RESOURCE_TABLE_COLS,
  ResourceCells,
  RunStateBadge,
} from "./ProcessCells";

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
}: Readonly<{
  converter: IsruConverterEntry;
  highlighted: boolean;
  /** The recipe still holds; the rates, run state and starved diagnostic do not. */
  held: boolean;
}>) {
  /*
   * A running converter whose every output arrived as zero is starved. A process
   * with no outputs (a scrubber) is exempt, and an absent rate is an unread one,
   * not a stall.
   */
  const starved =
    !converterHeld &&
    converter.running === true &&
    converter.outputs.length > 0 &&
    converter.outputs.every((flow) => flow.rate?.isZero() === true);

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
          {starved && <Badge tone="warn">no output</Badge>}
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
              ratesHeld={converterHeld}
            />
          ))}
          {converter.outputs.length === 0 && <NoFlows />}
          {converter.outputs.map((flow, index) => (
            <ResourceCells
              key={`out-${flow.resource ?? index}`}
              flow={flow}
              direction="out"
              ratesHeld={converterHeld}
            />
          ))}
        </Grid>
      </Stack>
    </Card>
  );
}
