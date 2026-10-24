import { BannerPill } from "@ksp-gonogo/ui";
import { useSyncExternalStore } from "react";
import {
  SETUP_LINKS,
  UPDATE_PULL_COMMAND,
  UPDATE_REMOVE_COMMAND,
} from "../firstRun/setupGuide";
import {
  assessModHandshake,
  describeBreakingHandshake,
  isBreakingHandshake,
} from "../telemetry/modHandshake";
import {
  getSitrepHello,
  subscribeSitrepHello,
} from "../telemetry/sitrepRuntime";
import { hostCompat } from "../uplinks/hostCompat";
import { VERSION } from "../version";

/**
 * Warns the operator on the main screen when the mod's wire contract has a
 * different major than this app's, or when the mod is too old to say which it
 * speaks. Names both versions and which side to update. Shows nothing until the
 * mod's hello arrives, and nothing while the two agree. When the app is the
 * older side it adds the container commands that replace it, with a link to
 * the README's upgrade steps.
 */
export function ModVersionBanner() {
  const hello = useSyncExternalStore(subscribeSitrepHello, getSitrepHello);
  if (!hello) return null;
  const handshake = assessModHandshake(hello, hostCompat);
  if (!isBreakingHandshake(handshake)) return null;
  const text = describeBreakingHandshake(handshake, hello.modVersion, VERSION);
  if (!text) return null;
  return (
    <BannerPill accent="var(--color-nogo-mark)" role="alert" interactive>
      <span>{text}</span>
      {handshake.kind === "mod-major-newer" && (
        <span>
          In a terminal run <code>{UPDATE_PULL_COMMAND}</code>, then{" "}
          <code>{UPDATE_REMOVE_COMMAND}</code> and the run command again (
          <a href={SETUP_LINKS.upgrading}>upgrade steps</a>).
        </span>
      )}
    </BannerPill>
  );
}
