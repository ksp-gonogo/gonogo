/*
 * The wizard's three automatic checks, each as a state and the sentence that
 * reports it. Its own step and the health step both print a check, and one
 * derivation keeps the two from ever disagreeing about the same fact.
 */

import type { DataSourceStatus } from "@ksp-gonogo/core";
import { relayBaseUrl } from "../peer/iceServers";
import { say } from "./copy";
import type { RelayHealth } from "./useRelayHealth";
import type {
  UplinkReadinessEntry,
  UseUplinkReadinessResult,
} from "./useUplinkReadiness";

/**
 * `attention` is a check that ran and found something worth reading that does
 * not stop Gonogo working, such as one Uplink among several being refused.
 */
export type CheckState = "checking" | "pass" | "attention" | "fail";

export interface SetupCheck {
  state: CheckState;
  text: string;
  /** Set when the check fails only because another check did, so a tally counts the cause once. */
  derived?: true;
}

/**
 * How long a connection may stay unanswered before the step stops calling it
 * "trying". A mod on this computer or the local network answers in well under a
 * second, and the stream's first retry is a second after a refusal, so five
 * seconds covers a slow network and still sees two refusals.
 */
export const CONNECT_GRACE_MS = 5000;

export function relayCheck(health: RelayHealth): SetupCheck {
  const url = relayBaseUrl();
  if (health === "checking")
    return {
      state: "checking",
      text: say("container.check.checking", { url }),
    };
  if (health === "ok")
    return { state: "pass", text: say("container.check.pass") };
  return { state: "fail", text: say("container.check.fail", { url }) };
}

/**
 * `gaveUp` is whether the connection has stayed unanswered past
 * {@link CONNECT_GRACE_MS}. A refused or silent port leaves the stream
 * "reconnecting" indefinitely, so only time separates a socket that is about to
 * open from one that is not going to; once it has passed, a reconnecting stream
 * is a failure whose fix the step shows, while the stream keeps retrying and
 * the check turns to pass by itself.
 */
export function connectionCheck(
  status: DataSourceStatus | undefined,
  address: string,
  gaveUp = false,
): SetupCheck {
  if (status === "connected")
    return { state: "pass", text: say("connect.check.pass", { address }) };
  if (status === "reconnecting")
    return gaveUp
      ? { state: "fail", text: say("connect.check.retrying", { address }) }
      : {
          state: "checking",
          text: say("connect.check.checking", { address }),
        };
  return { state: "fail", text: say("connect.check.fail", { address }) };
}

/**
 * Whether an address names the computer the browser is on: `localhost`, an
 * IPv4 loopback address or the IPv6 one. Used to tell whether KSP and the
 * dashboard share a computer.
 */
export function isThisComputer(host: string): boolean {
  const name = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return (
    name === "localhost" || name === "::1" || /^127(\.\d{1,3}){3}$/.test(name)
  );
}

/**
 * An installed Uplink the operator should look at: the mod refused it or calls
 * it unavailable, or no working client for it is running here. A degraded
 * Uplink is not one, because degraded is the ordinary state of an Uplink whose
 * part is not on the active craft.
 */
export function needsAttention(entry: UplinkReadinessEntry): boolean {
  if (
    !entry.installed ||
    entry.bundled ||
    entry.state === "mod-only" ||
    entry.state === "skipped"
  )
    return false;
  if (entry.rosterEntry?.health.state === "unavailable") return true;
  return entry.state !== "loaded" && entry.state !== "loading";
}

export function uplinksCheck(
  { entries, waitingForMod }: UseUplinkReadinessResult,
  connection?: SetupCheck,
): SetupCheck {
  if (waitingForMod && connection?.state === "fail")
    return {
      state: "fail",
      text: say("uplinks.check.noConnection"),
      derived: true,
    };
  if (waitingForMod)
    return {
      state: "checking",
      text: say("uplinks.check.waiting"),
    };

  const installed = entries.filter(
    (entry) => entry.installed && !entry.bundled,
  );
  if (installed.length === 0)
    return {
      state: "pass",
      text: say("uplinks.check.none"),
    };

  const attention = installed.filter(needsAttention).length;
  const skipped = installed.filter((entry) => entry.state === "skipped").length;
  if (attention === 0 && skipped > 0)
    return {
      state: "pass",
      text: say("uplinks.check.skipped", {
        installed: installed.length,
        skipped,
      }),
    };
  if (attention === 0)
    return {
      state: "pass",
      text: say("uplinks.check.allWorking", { installed: installed.length }),
    };
  return {
    state: "attention",
    text: say("uplinks.check.attention", {
      installed: installed.length,
      attention,
    }),
  };
}
