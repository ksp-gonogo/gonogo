import type { LogEntry } from "@ksp-gonogo/logger";
import { makeBrowserAxiomTransport } from "../analytics/axiomTransportFactory";

const DELIVERY_DEADLINE_MS = 10_000;

/**
 * Ships one report entry to the developer through a transport built for this
 * send alone and disposed straight after, so the operator's explicit Send
 * reaches Axiom whatever the analytics setting says and background logging
 * stays off. Rejects with a sentence the form can show as it is: the build has
 * no way to send, the request failed, or it did not finish in time.
 */
export async function sendReportOnce(entry: LogEntry): Promise<void> {
  let failure: unknown;
  const transport = makeBrowserAxiomTransport((error) => {
    failure = error;
  });
  if (!transport) {
    throw new Error("This build cannot send reports to the developer.");
  }
  try {
    transport.send([entry]);
    const outcome = await Promise.race([
      transport.flush().then(() => "flushed" as const),
      new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), DELIVERY_DEADLINE_MS),
      ),
    ]);
    if (outcome === "timeout" || failure !== undefined) {
      throw new Error(
        "The report could not be sent. Check your connection and try again.",
      );
    }
  } finally {
    transport.dispose();
  }
}
