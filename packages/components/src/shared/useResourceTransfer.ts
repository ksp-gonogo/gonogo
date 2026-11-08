import { useTelemetry } from "@ksp-gonogo/core";
import { useCommand } from "@ksp-gonogo/sitrep-client";
import { resourceTransferModel, stillTrue } from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";

const NO_PARTS: never[] = [];

/** The active vessel's tanks, running transfers and transfer commands, for any widget offering a transfer. */
export function useResourceTransfer() {
  const partsReading = useTelemetry("vessel.parts");
  const transfersReading = useTelemetry("vessel.resourceTransfers");
  const reachReading = useTelemetry("vessel.transferReach");
  const start = useCommand("vessel.resource.transfer.start");
  const stop = useCommand("vessel.resource.transfer.stop");

  const parts = stillTrue(partsReading, undefined)?.parts ?? NO_PARTS;
  const reach = stillTrue(reachReading, undefined);
  const transfers = stillTrue(transfersReading, undefined)?.transfers;
  const held = transfersReading.state === "held";

  return useMemo(
    () => resourceTransferModel({ parts, reach, transfers, held, start, stop }),
    [parts, reach, transfers, held, start, stop],
  );
}
