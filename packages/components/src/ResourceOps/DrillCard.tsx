import type { IsruDrillEntry } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Card,
  Grid,
  Inline,
  ReadoutCaption,
  resourceColor,
  Stack,
  Unit,
} from "@ksp-gonogo/ui-kit";
import {
  RESOURCE_TABLE_COLS,
  ResourceCells,
  RunStateBadge,
  WithheldOr,
} from "./ProcessCells";

export function DrillCard({
  drill,
  highlighted,
  notCurrent: drillNotCurrent,
}: Readonly<{
  drill: IsruDrillEntry;
  highlighted: boolean;
  /** The drill channel went stale: the rig is still there, its figures are not. */
  notCurrent: boolean;
}>) {
  return (
    <Card
      aria-current={highlighted ? "true" : undefined}
      tone={!drillNotCurrent && drill.running ? "go" : "default"}
      identityColor={drill.resource ? resourceColor(drill.resource) : undefined}
      title={drill.partTitle ?? drill.partId ?? "Drill"}
      titleRight={
        <Inline wrap>
          {/* Absent on a harvester with no deploy animation, which is not "retracted". */}
          {drill.deployed !== null && drill.deployed !== undefined && (
            <Badge severity={drill.deployed ? "nominal" : "info"}>
              {drill.deployed ? "deployed" : "retracted"}
            </Badge>
          )}
          {/* A harvester stops itself when its tank fills or the ore runs out, so run state is never held over. */}
          {drillNotCurrent ? (
            <Badge severity="info">run state held</Badge>
          ) : (
            <RunStateBadge running={drill.running} />
          )}
        </Inline>
      }
    >
      <Stack>
        <Grid cols={RESOURCE_TABLE_COLS} rowGap="readout-row" align="baseline">
          <ResourceCells
            flow={{ resource: drill.resource, rate: drill.rate }}
            direction="extract"
            ratesNotCurrent={drillNotCurrent}
          />
        </Grid>
        <Inline>
          <ReadoutCaption>abundance</ReadoutCaption>
          {/* Abundance belongs to where the drill stands, and it can be driven elsewhere while the link is down. */}
          <WithheldOr
            withheld={drillNotCurrent}
            figure={
              drill.abundance === null ||
              drill.abundance === undefined ? null : (
                <Unit value={drill.abundance} decimals={2} />
              )
            }
          />
        </Inline>
      </Stack>
    </Card>
  );
}
