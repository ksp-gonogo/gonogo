import type { IsruDrillEntry } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Card,
  Grid,
  Inline,
  ReadoutCaption,
  resourceColor,
  Stack,
  Tooltip,
  Unit,
} from "@ksp-gonogo/ui-kit";
import {
  RESOURCE_TABLE_COLS,
  ResourceCells,
  RunStateBadge,
  WithheldOr,
} from "./ProcessCells";
import { ProcessSwitch, type ProcessSwitchHandles } from "./ProcessSwitch";
import { isStarved, reportedStarved } from "./rates";

export function DrillCard({
  drill,
  highlighted,
  held: drillHeld,
  switchHandles,
}: Readonly<{
  switchHandles: ProcessSwitchHandles;
  drill: IsruDrillEntry;
  highlighted: boolean;
  /** The drill channel was held: the rig is still there, its figures are not. */
  held: boolean;
}>) {
  const starved = !drillHeld && isStarved(drill);

  return (
    <Card
      aria-current={highlighted ? "true" : undefined}
      tone={!drillHeld && drill.running ? "go" : "neutral"}
      identityColor={drill.resource ? resourceColor(drill.resource) : undefined}
      title={drill.partTitle ?? drill.partId ?? "Drill"}
      titleRight={
        <Inline wrap>
          {/* Absent on a harvester with no deploy animation, which is not "retracted". */}
          {drill.deployed !== null && drill.deployed !== undefined && (
            <Badge tone={drill.deployed ? "go" : "info"}>
              {drill.deployed ? "deployed" : "retracted"}
            </Badge>
          )}
          {/* A harvester stops itself when its tank fills or the ore runs out, so run state is never held over. */}
          {drillHeld ? (
            <Badge tone="info">run state held</Badge>
          ) : (
            <RunStateBadge running={drill.running} />
          )}
          {starved && (
            <Tooltip text={drill.shortfall ?? undefined}>
              <Badge tone="warn">no output</Badge>
            </Tooltip>
          )}
        </Inline>
      }
    >
      <Stack>
        <Grid cols={RESOURCE_TABLE_COLS} rowGap="readout-row" align="baseline">
          <ResourceCells
            flow={{ resource: drill.resource, rate: drill.rate }}
            direction="extract"
            ratesHeld={drillHeld || reportedStarved(drill)}
          />
        </Grid>
        <Inline>
          <ReadoutCaption>abundance</ReadoutCaption>
          {/* Abundance belongs to where the drill stands, and it can be driven elsewhere while the link is down. */}
          <WithheldOr
            withheld={drillHeld}
            figure={
              drill.abundance === null ||
              drill.abundance === undefined ? null : (
                <Unit value={drill.abundance} decimals={2} />
              )
            }
          />
        </Inline>
        <ProcessSwitch
          handles={switchHandles}
          partId={drill.partId}
          converterName={drill.converterName}
          title={drill.partTitle ?? drill.partId ?? "drill"}
          running={drill.running}
          held={drillHeld}
          extensions={drill.extensions}
        />
      </Stack>
    </Card>
  );
}
