import type { TaggedLogger } from "@ksp-gonogo/logger";
import type { TransportStatus } from "@ksp-gonogo/sitrep-sdk";

/**
 * Logs each change in the main screen's connection to the game: the first
 * connection, every drop, and every reconnection with how long the stream was
 * down. A reconnect loop logs one line when it starts, not one per attempt.
 * Feed it every status the transport reports.
 */
export function streamStatusTracer(
  log: TaggedLogger,
  now: () => number = Date.now,
): (status: TransportStatus) => void {
  let last: TransportStatus | undefined;
  let everConnected = false;
  let waitingSaid = false;
  let downSince: number | undefined;

  return (status) => {
    if (status === last) return;
    const previous = last;
    last = status;
    if (status === "connected") {
      if (!everConnected) {
        everConnected = true;
        log.info("stream connected");
        return;
      }
      const outageSeconds =
        downSince === undefined
          ? undefined
          : Math.round((now() - downSince) / 1000);
      downSince = undefined;
      log.info("stream reconnected", { outageSeconds });
      return;
    }
    if (previous === "connected") {
      downSince = now();
      if (status === "disconnected") log.info("stream closed");
      else log.warn("stream lost, reconnecting", { status });
      return;
    }
    if (!everConnected && status === "reconnecting" && !waitingSaid) {
      waitingSaid = true;
      log.info("waiting for the game to accept the stream");
    }
  };
}

/** The fields of the mod's `hello` frame worth keeping in the log. */
export interface HelloFacts {
  modVersion: string | undefined;
  contractMajor: number;
  contractMinor: number;
  /** True when the mod reports a different run than the last hello: KSP was restarted. */
  rebooted: boolean;
}

/** Logs the mod's greeting on each connection: which mod build is answering, and whether the game restarted since the last one. */
export function traceHello(log: TaggedLogger, hello: HelloFacts): void {
  log.info(hello.rebooted ? "mod hello, the game has restarted" : "mod hello", {
    modVersion: hello.modVersion,
    contract: `${hello.contractMajor}.${hello.contractMinor}`,
  });
}
