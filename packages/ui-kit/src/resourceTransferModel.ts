import type {
  CommandArgs,
  CommandReply,
  ResourceTransferModel,
} from "@ksp-gonogo/sitrep-sdk";
import type { CommandButtonHandle } from "./CommandButton/commandControl";

/**
 * The model {@link ResourceTransferPicker} and {@link ResourceFlowRow} read:
 * `resourceTransferModel` built with `useCommand` handles for the two transfer
 * commands.
 *
 * @category Telemetry
 */
export type UiResourceTransferModel = ResourceTransferModel<
  CommandButtonHandle<
    CommandReply<"vessel.resource.transfer.start">,
    CommandArgs<"vessel.resource.transfer.start">
  >,
  CommandButtonHandle<
    CommandReply<"vessel.resource.transfer.stop">,
    CommandArgs<"vessel.resource.transfer.stop">
  >
>;
