import { useStatusContribution } from "@ksp-gonogo/ui-kit";
import { useSyncExternalStore } from "react";
import { getUplinkOutcomes, subscribeUplinkOutcomes } from "./loaderState";

/** What a widget's panel says while its Uplink's client is an unvouched development build. */
export const UNVOUCHED_DEV_CLIENT_LABEL = "Unvouched development client";

/**
 * The same thing at length, for the Uplink's own status page: who can end up
 * here, what was not checked, and that a released build never shows it.
 */
export const UNVOUCHED_DEV_CLIENT_DETAIL =
  "Unvouched development client. Its plugin names a development path on this " +
  "computer and vouches for no hash, so nothing checked this code before it ran. " +
  "A released build is checked against the hash its plugin carries and does not show this.";

/**
 * Says on a widget's own panel that the code drawing it is a development
 * client nobody vouched for. `ownerId` is the Uplink the widget's registration
 * names; a widget with no owner, or whose Uplink loaded a vouched client,
 * contributes nothing.
 *
 * Mounted once per grid item, inside that item's status store, so the words
 * reach the panel's summary the same way an alarm or a stale stream does.
 */
export function UnvouchedDevClientBridge({
  ownerId,
}: {
  ownerId: string | undefined;
}) {
  const outcomes = useSyncExternalStore(
    subscribeUplinkOutcomes,
    getUplinkOutcomes,
    getUplinkOutcomes,
  );
  const unvouched =
    ownerId !== undefined &&
    outcomes.some(
      (outcome) => outcome.id === ownerId && outcome.unvouchedDevClient,
    );
  useStatusContribution(
    unvouched
      ? {
          id: "uplink:unvouched-dev-client",
          severity: "warn",
          label: UNVOUCHED_DEV_CLIENT_LABEL,
        }
      : null,
  );
  return null;
}
