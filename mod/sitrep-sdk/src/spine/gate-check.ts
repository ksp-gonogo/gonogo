import type { GateVerdict } from "../__generated__/contract";
import { GateOutcome } from "../__generated__/contract";

/** The question command: what a command's gate says about one call, from this session's command centre, without sending it. */
export const GATE_CHECK_COMMAND = "system.gate.check";

/**
 * How long a `check` waits for the next one before asking the mod, so a form
 * that calls it on every keystroke asks once the operator pauses.
 */
export const GATE_CHECK_DEBOUNCE_MS = 250;

const OUTCOMES: readonly unknown[] = Object.values(GateOutcome);

/**
 * The verdict inside a `system.gate.check` reply, or `undefined` for a refusal
 * or anything that is not one. A check that could not be answered says nothing
 * about the command, so the caller draws the control as it would an unchecked
 * one.
 */
export function readGateCheckReply(result: unknown): GateVerdict | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  if ("success" in result && result.success === false) return undefined;
  const payload = "payload" in result ? result.payload : undefined;
  if (typeof payload !== "object" || payload === null) return undefined;
  if (!("outcome" in payload) || !OUTCOMES.includes(payload.outcome)) {
    return undefined;
  }
  return payload as GateVerdict;
}

/**
 * A key that is equal for two argument bags holding the same values however
 * their properties were ordered, so an answer is matched to the choice it was
 * asked about.
 */
export function gateCheckKey(args: unknown): string {
  return JSON.stringify(args ?? null, (_name, value: unknown) =>
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        )
      : value,
  );
}
