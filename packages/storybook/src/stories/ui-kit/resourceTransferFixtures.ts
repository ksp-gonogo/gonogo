import {
  type CommandArgs,
  type CommandReply,
  KspTankFlowMode,
  type ResourceTransferJob,
  resourceTransferModel,
  TransferJobState,
  type VesselPart,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { createFakeCommand } from "@ksp-gonogo/sitrep-sdk/testing";
import type { UiResourceTransferModel } from "@ksp-gonogo/ui-kit";

type TankPart = Pick<VesselPart, "id" | "title" | "resources">;

function tankPart(
  id: string,
  title: string,
  amount: number,
  capacity: number,
  flowMode = KspTankFlowMode.Both,
  locked = false,
): TankPart {
  return {
    id,
    title,
    resources: {
      LiquidFuel: {
        amount: value("units", amount),
        maxAmount: value("units", capacity),
        transferable: true,
        flowMode,
        locked,
      },
    },
  };
}

const PARTS = [
  tankPart("1", "Upper tank", 518.4, 720, KspTankFlowMode.Out),
  tankPart("2", "Drop tank", 166.2, 360, KspTankFlowMode.Both, true),
  tankPart("3", "FL-T400 Fuel Tank", 32.1, 180),
];

/** A transfer in progress between two of the tanks in {@link transferModel}. */
export const RUNNING_JOB: ResourceTransferJob = {
  id: "t1",
  resource: "LiquidFuel",
  fromPartIds: ["2"],
  toPartIds: ["3"],
  untilFull: true,
  moved: value("units", 64.2),
  rate: value("units/s", 9),
  state: TransferJobState.Running,
  startedUt: value("ut", 1),
};

/** The model the transfer controls read, with commands that answer nothing. */
export function transferModel(
  transfers: readonly ResourceTransferJob[] = [],
): UiResourceTransferModel {
  return resourceTransferModel({
    parts: PARTS,
    reach: undefined,
    transfers,
    held: false,
    start: createFakeCommand<
      CommandArgs<"vessel.resource.transfer.start">,
      CommandReply<"vessel.resource.transfer.start">
    >().handle,
    stop: createFakeCommand<
      CommandArgs<"vessel.resource.transfer.stop">,
      CommandReply<"vessel.resource.transfer.stop">
    >().handle,
  });
}
