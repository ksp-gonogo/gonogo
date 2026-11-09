import {
  type ResourceTransferJob,
  transferSideLabel,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Inline } from "./Inline";
import { ReadoutCaption } from "./Readout";
import type { UiResourceTransferModel } from "./resourceTransferModel";
import { Stack } from "./Stack";
import { Text } from "./Text";
import { Truncate } from "./Truncate";
import { Unit } from "./Unit";

/**
 * Props for {@link ResourceFlowRow}.
 *
 * @category Telemetry
 */
export interface ResourceFlowRowProps {
  /** The running transfer to show. */
  job: ResourceTransferJob;
  /** The model from `resourceTransferModel`, for part titles, the held state and the stop command. */
  transfer: UiResourceTransferModel;
}

/**
 * One running resource transfer between tanks of the active vessel: the route
 * from source tanks to destination tanks, the amount moved, the rate and a stop
 * control. Useful for showing the operator that fuel is moving and letting them
 * end it. Used by the vessel schematic, the fuel widget and resource operations.
 *
 * The figures are the last received ones. A stop takes effect when the command
 * arrives, and the row stays until word comes back that the transfer ended.
 *
 * @category Telemetry
 */
export function ResourceFlowRow({
  job,
  transfer,
}: Readonly<ResourceFlowRowProps>) {
  const from = transferSideLabel(job.fromPartIds, transfer.titleOf);
  const to = transferSideLabel(job.toPartIds, transfer.titleOf);
  const route = `${from} → ${to}`;
  return (
    <Stack>
      <Inline>
        <Truncate style={ROUTE}>{route}</Truncate>
        {transfer.held && <Badge tone="info">held</Badge>}
      </Inline>
      <Inline wrap>
        <Inline wrap>
          <ReadoutCaption>Moved</ReadoutCaption>
          <Text size="sm">
            <Unit value={job.moved} decimals={1} />
            {job.requested != null ? (
              <>
                {" / "}
                <Unit value={job.requested} decimals={1} />
              </>
            ) : (
              " / until full"
            )}
          </Text>
        </Inline>
        <Inline>
          <ReadoutCaption>Rate</ReadoutCaption>
          <Text size="sm">
            <Unit value={job.rate ?? value("units/s", 0)} decimals={1} />
          </Text>
        </Inline>
      </Inline>
      <Inline>
        <Button
          size="sm"
          variant="ghost"
          command={transfer.stop.with(
            { all: false, transferId: job.id },
            { label: `Stop ${job.resource} transfer, ${route}` },
          )}
        >
          Stop
        </Button>
      </Inline>
    </Stack>
  );
}

const ROUTE = {
  fontSize: "var(--font-size-value)",
  color: "var(--color-text-primary)",
  flex: 1,
  minWidth: 0,
} as const;
