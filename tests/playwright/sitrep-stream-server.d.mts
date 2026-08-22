import type { Server } from "node:http";

/** The hand-authored telemetry snapshot this fixture replays: topic -> payload. */
export declare const SNAPSHOT: Record<string, unknown>;

/** Topics deliberately published in a shape the contract does not declare. */
export declare const NONCONFORMING_FIXTURE_TOPICS: Record<string, string>;

export declare function startReplayServer(options?: {
  port?: number;
  extraTopics?: Record<string, unknown>;
}): Server;
