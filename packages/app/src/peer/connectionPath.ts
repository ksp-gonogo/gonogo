/**
 * How a data connection between the main screen and a station is actually
 * carried: "lan" when both ends use host candidates, "internet" when a
 * server-reflexive or peer-reflexive candidate is in the selected pair, and
 * "relayed" when either end goes through the relay server.
 */
export type ConnectionPath = "lan" | "internet" | "relayed";

export const CONNECTION_PATH_LABEL: Record<ConnectionPath, string> = {
  lan: "direct (LAN)",
  internet: "direct (internet)",
  relayed: "relayed",
};

/**
 * Read the selected candidate pair from `getStats()`. Null when the browser
 * reports no selected pair yet or `getStats` is unavailable.
 */
export async function readConnectionPath(pc: {
  getStats(): Promise<{
    forEach(cb: (stat: Record<string, unknown>) => void): void;
  }>;
}): Promise<ConnectionPath | null> {
  let report: Awaited<ReturnType<typeof pc.getStats>>;
  try {
    report = await pc.getStats();
  } catch {
    return null;
  }
  const byId = new Map<string, Record<string, unknown>>();
  let selectedId: unknown;
  let fallbackPair: Record<string, unknown> | undefined;
  report.forEach((stat) => {
    byId.set(String(stat.id), stat);
    if (stat.type === "transport" && stat.selectedCandidatePairId) {
      selectedId = stat.selectedCandidatePairId;
    }
    if (
      stat.type === "candidate-pair" &&
      stat.nominated === true &&
      stat.state === "succeeded"
    ) {
      fallbackPair = stat;
    }
  });
  const pair =
    (selectedId ? byId.get(String(selectedId)) : undefined) ?? fallbackPair;
  if (!pair) return null;
  const local = byId.get(String(pair.localCandidateId));
  const remote = byId.get(String(pair.remoteCandidateId));
  const types = [local?.candidateType, remote?.candidateType];
  if (types.includes("relay")) return "relayed";
  if (types.every((t) => t === "host")) return "lan";
  if (types.every((t) => typeof t === "string")) return "internet";
  return null;
}
