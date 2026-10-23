import { useTelemetry } from "@ksp-gonogo/core";
import { useUtNow } from "@ksp-gonogo/sitrep-client";
import { type TopicPayload, type Value, value } from "@ksp-gonogo/sitrep-sdk";

/** What a command needs of the craft that `vessel.control` states, and the words for it when the craft lacks it. */
interface CommandCapability {
  /** The capability's name as the warning gives it. */
  name: string;
  /** Whether the last `vessel.control` says the craft lacks it. */
  missing: (control: TopicPayload<"vessel.control">) => boolean;
  /** The craft's own sentence for why, when it states one. */
  reason: (control: TopicPayload<"vessel.control">) => string | undefined;
}

/*
 * Only turning SAS on is held back by a craft with none, so a SAS that is
 * already on can still be switched off without a warning.
 */
const SAS: CommandCapability = {
  name: "No SAS",
  missing: (control) => control.sasAvailable === false && control.sas !== true,
  reason: (control) => control.sasUnavailableReason ?? undefined,
};

const CAPABILITIES: Readonly<Record<string, CommandCapability>> = {
  "vessel.control.setSas": SAS,
  "vessel.control.setSasMode": SAS,
};

/** A command's missing capability, with how old the reading that says so is. */
export interface CapabilityWarning {
  /** The capability's name, such as `"No SAS"`. */
  name: string;
  /** The craft's own sentence for why it lacks it, when it states one. */
  reason: string | undefined;
  /** How old the last `vessel.control` is; undefined while the clock is unknown. */
  age: Value<"s"> | undefined;
}

/**
 * What a command warns about the active craft, from the last `vessel.control`
 * the operator has: `null` for a command with no capability to check, before
 * any `vessel.control` has arrived (nothing is known, which is not a missing
 * capability), and for a craft that has the capability. A warning never stops
 * the command: the craft may have gained the capability since the reading.
 * Used by the action group toggle for SAS.
 */
export function useCommandCapabilityWarning(
  command: string | null,
): CapabilityWarning | null {
  const control = useTelemetry("vessel.control");
  const utNow = useUtNow();
  const capability = command === null ? undefined : CAPABILITIES[command];
  if (!capability) return null;
  if (control.state !== "observed" && control.state !== "held") return null;
  if (!capability.missing(control.value)) return null;
  const readAt = control.state === "observed" ? control.atUt : control.asOfUt;
  return {
    name: capability.name,
    reason: capability.reason(control.value),
    age:
      utNow === undefined ? undefined : value("ut", utNow).minus(readAt).max(0),
  };
}
