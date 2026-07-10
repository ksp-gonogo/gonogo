/**
 * The `comms` capability: the milestone's proof point that the whole M3
 * delay engine is just one swappable capability-kernel provider.
 *
 * This is the SMALLEST interface that lets a test observe "delayed vs
 * immediate" through the kernel: record a sample, subscribe to it, and read
 * timing off a shared `Clock` (courier-provider.ts and vanilla-comms.ts both
 * expose the SAME clock instance they schedule delivery on, so a test can
 * drive/observe delivery without reaching into either provider's internals).
 *
 * Declared `exclusive` — at most one `comms` provider is active — with
 * `vanilla-comms`'s zero-delay implementation as the fallback when no real
 * provider is registered (or survives version gating).
 */
import type { Clock } from "@ksp-gonogo/sitrep-server";
import type { CapabilityDescriptor } from "../capability";
import { createVanillaComms } from "./vanilla-comms";

export const COMMS_CAPABILITY_ID = "comms";

/** One delivered sample, as observed by a `comms` subscriber. */
export interface CommsSample {
  value: unknown;
  /** UT the sample was valid/recorded at (before any delay). */
  validAt: number;
  /** UT delivery actually fired at (validAt + provider's delay). */
  deliveredAt: number;
}

/** The minimal shape every `comms` provider (real or vanilla) exposes. */
export interface CommsCapability {
  /** Shared clock the provider schedules delivery on — advance it to observe delayed vs immediate delivery. */
  readonly clock: Clock;
  /** Record a telemetry sample valid at `validAtUt`, scheduling delayed delivery to current subscribers. */
  record(topic: string, value: unknown, validAtUt: number): void;
  /** Subscribe to delivery of samples for `topic`. Returns an unsubscribe function. */
  subscribe(topic: string, onData: (sample: CommsSample) => void): () => void;
}

/** The `comms` capability descriptor: exclusive, vanilla-backed fallback. */
export const commsCapability: CapabilityDescriptor<CommsCapability> = {
  id: COMMS_CAPABILITY_ID,
  exclusive: true,
  vanilla: () => createVanillaComms(),
};
