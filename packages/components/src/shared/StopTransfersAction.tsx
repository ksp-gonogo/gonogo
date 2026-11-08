import { useActionInput } from "@ksp-gonogo/core";
import type { UiResourceTransferModel } from "@ksp-gonogo/ui-kit";

/** Answers the `stop-transfers` serial action. Mounted only while a transfer is running, since there is nothing to stop otherwise. */
export function StopTransfersAction({
  transfer,
}: Readonly<{ transfer: UiResourceTransferModel }>) {
  useActionInput({
    "stop-transfers": (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      void transfer.stop.dangerouslySendWithoutInput(
        { all: true },
        { label: "Stop all resource transfers" },
      );
      return undefined;
    },
  });
  return null;
}
