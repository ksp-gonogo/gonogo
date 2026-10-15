import { BannerPill } from "@ksp-gonogo/ui";
import { useSyncExternalStore } from "react";
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
 * mod's hello arrives, and nothing while the two agree.
 */
export function ModVersionBanner() {
  const hello = useSyncExternalStore(subscribeSitrepHello, getSitrepHello);
  if (!hello) return null;
  const handshake = assessModHandshake(hello, hostCompat);
  if (!isBreakingHandshake(handshake)) return null;
  const text = describeBreakingHandshake(handshake, hello.modVersion, VERSION);
  if (!text) return null;
  return (
    <BannerPill accent="var(--color-nogo-mark)" role="alert">
      <span>{text}</span>
    </BannerPill>
  );
}
