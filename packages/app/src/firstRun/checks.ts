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
}

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

export function connectionCheck(
  status: DataSourceStatus | undefined,
  address: string,
): SetupCheck {
  if (status === "connected")
    return { state: "pass", text: say("connect.check.pass", { address }) };
  if (status === "reconnecting")
    return {
      state: "checking",
      text: say("connect.check.checking", { address }),
    };
  return { state: "fail", text: say("connect.check.fail", { address }) };
}

/**
 * An installed Uplink the operator should look at: the mod refused it or calls
 * it unavailable, or no working client for it is running here. A degraded
 * Uplink is not one, because degraded is the ordinary state of an Uplink whose
 * part is not on the active craft.
 */
export function needsAttention(entry: UplinkReadinessEntry): boolean {
  if (!entry.installed || entry.state === "mod-only") return false;
  if (entry.rosterEntry?.health.state === "unavailable") return true;
  return entry.state !== "loaded" && entry.state !== "loading";
}

export function uplinksCheck({
  entries,
  waitingForMod,
}: UseUplinkReadinessResult): SetupCheck {
  if (waitingForMod)
    return {
      state: "checking",
      text: say("uplinks.check.waiting"),
    };

  const installed = entries.filter((entry) => entry.installed);
  if (installed.length === 0)
    return {
      state: "pass",
      text: say("uplinks.check.none"),
    };

  const attention = installed.filter(needsAttention).length;
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
