/** One item's refusal, in the shape `system.uplink.gates` carries a verdict. */
export interface ItemRefusal {
  errorCode: string;
  detail?: string;
  breach?: Record<string, unknown>;
}

/**
 * A `system.uplink.gates` payload for one command whose gate depends on which
 * item a call names: the command itself abstains, and each item listed in
 * `refused` carries its own Fail, exactly as the mod publishes it.
 */
export function perItemGateReport(
  command: string,
  itemArgument: string,
  refused: Record<string, ItemRefusal>,
) {
  return {
    gates: [
      {
        command,
        // GateOutcome.Abstain: nothing is said about the command until an item is named.
        verdict: { outcome: 2, detail: "" },
        itemArgument,
        items: Object.entries(refused).map(([value, refusal]) => ({
          value,
          // GateOutcome.Fail.
          verdict: { outcome: 1, detail: "", ...refusal },
        })),
      },
    ],
  };
}
