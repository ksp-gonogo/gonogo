// The loud surface for an Uplink integrity failure.
//
// Every quarantine reaches Settings › Loaded clients as a row, which is right
// for a compat gate or a dead CDN: the operator lost a widget and will go
// looking when they miss it. A hash disagreement is not that. It says the bytes
// served are not the bytes the mod vouched for, and an operator learning that
// only if they happen to open a settings tab is an operator who never learns
// it.
//
// So this renders at the top of the screen, above the dashboard, on the main
// screen and on a station alike, and it renders ONLY for integrity failures.
// Its presence is the signal; a row that also appears for an ordinary miss
// would not be one.
//
// There is no dismiss. A quarantine is a persistent state, not a notification,
// and this banner is that state drawn: it clears when the state clears (the
// bundle is fixed or removed and the app reloads) and not before. A control
// that made the fact go away while the fault stayed would be the one thing
// this must not offer.

import { Badge, Card, Cluster, Stack, Text } from "@ksp-gonogo/ui-kit";
import { useSyncExternalStore } from "react";
import {
  getUplinkOutcomes,
  integrityFailures,
  subscribeUplinkOutcomes,
  type UplinkLoadOutcome,
} from "./loaderState";
import { UplinkIntegrityDetail } from "./UplinkIntegrityDetail";

function FailedUplink({ outcome }: Readonly<{ outcome: UplinkLoadOutcome }>) {
  if (!outcome.integrity) return null;
  return (
    <Stack gap="xs">
      <Cluster justify="start" gap="sm" wrap>
        <Text weight="semibold">{outcome.name}</Text>
        <Text tone="muted" size="sm">
          {outcome.id}
          {outcome.version ? `@${outcome.version}` : ""}
        </Text>
      </Cluster>
      <UplinkIntegrityDetail failure={outcome.integrity} />
    </Stack>
  );
}

/**
 * `role="status"` / `aria-live="polite"`, not `alert` / `assertive`.
 *
 * The repo reserves the assertive channel for events that must INTERRUPT, and
 * an integrity failure has already been acted on by the time this renders: the
 * loader refused before `import()`, so nothing from the bundle is running and
 * nothing gets worse in the next ten seconds. There is no in-flight action to
 * abort, only a completed refusal to report, which is exactly the polite
 * channel's case.
 *
 * It is also the honest one. The loader finishes before the first render on the
 * main screen, so this region is populated at mount and a live region announces
 * nothing at mount either way: what carries it to a screen reader is the text
 * sitting at the top of the main landmark, and what carries it to everyone else
 * is the red block above the dashboard. Borrowing the ABORT channel would not
 * have made it louder, only made ABORT quieter.
 */
export function UplinkIntegrityBanner() {
  const outcomes = useSyncExternalStore(
    subscribeUplinkOutcomes,
    getUplinkOutcomes,
  );
  const failed = integrityFailures(outcomes);
  if (failed.length === 0) return null;

  return (
    <Card
      as="section"
      tone="alert"
      role="status"
      aria-live="polite"
      aria-label="Uplink integrity"
    >
      <Stack gap="md">
        <Cluster justify="start" gap="sm" wrap>
          <Badge severity="critical">Integrity failure</Badge>
          <Text tone="nogo" weight="semibold">
            {failed.length === 1
              ? "1 Uplink client quarantined before import"
              : `${failed.length} Uplink clients quarantined before import`}
          </Text>
        </Cluster>
        <Text tone="muted" size="sm">
          {failed.length === 1
            ? "Nothing from it is running."
            : "Nothing from them is running."}{" "}
          A hash that disagrees means the bytes on the wire are not the bytes
          that were vouched for: tampering, a wrong URL, or a stale CDN.
        </Text>
        {failed.map((outcome) => (
          <FailedUplink key={outcome.id} outcome={outcome} />
        ))}
      </Stack>
    </Card>
  );
}
