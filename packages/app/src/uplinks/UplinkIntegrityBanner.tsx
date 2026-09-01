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
//
// The banner therefore splits its findings rather than growing one control for
// all of them. MEASURED findings (an artifact was fetched and hashes to
// something nobody vouched for) keep exactly the section they always had, with
// no control of any kind. DECLARED findings (the mod and the index each expect a
// different build, nothing fetched) get their own section and a "Use anyway"
// route, which is not a dismiss: it records a decision about one id, one
// version and one pair of hashes, the bundle is still hashed against the index,
// and the fault is gone rather than hidden once the operator reloads.

import { Badge, Card, Cluster, Stack, Text } from "@ksp-gonogo/ui-kit";
import { useSyncExternalStore } from "react";
import {
  getUplinkOutcomes,
  integrityFailures,
  subscribeUplinkOutcomes,
  type UplinkLoadOutcome,
} from "./loaderState";
import { UplinkIntegrityDetail } from "./UplinkIntegrityDetail";
import { canOverrideSkew, UplinkSkewOverride } from "./UplinkSkewOverride";

function FailedUplink({
  outcome,
  override,
}: Readonly<{ outcome: UplinkLoadOutcome; override?: boolean }>) {
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
      {override && <UplinkSkewOverride outcome={outcome} />}
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

  const declared = failed.filter(canOverrideSkew);
  const measured = failed.filter((o) => !canOverrideSkew(o));

  return (
    <Card
      as="section"
      tone="alert"
      role="status"
      aria-live="polite"
      aria-label="Uplink integrity"
    >
      <Stack gap="md">
        {/* The headline grades on what is actually here. A banner that shouts
            "integrity failure" over nothing but channel skew spends the loud
            channel on the ordinary case, which is the same mistake as firing it
            for a compat gate. */}
        <Cluster justify="start" gap="sm" wrap>
          <Badge severity={measured.length > 0 ? "critical" : "warning"}>
            {measured.length > 0 ? "Integrity failure" : "Hash disagreement"}
          </Badge>
          <Text tone={measured.length > 0 ? "nogo" : "warn"} weight="semibold">
            {failed.length === 1
              ? "1 Uplink client quarantined before import"
              : `${failed.length} Uplink clients quarantined before import`}
          </Text>
        </Cluster>
        {measured.length > 0 && (
          <Stack gap="md">
            <Text tone="muted" size="sm">
              {measured.length === 1
                ? "Nothing from it is running."
                : "Nothing from them is running."}{" "}
              A hash that disagrees means the bytes on the wire are not the
              bytes that were vouched for: tampering, a wrong URL, or a stale
              CDN.
            </Text>
            {measured.map((outcome) => (
              <FailedUplink key={outcome.id} outcome={outcome} />
            ))}
          </Stack>
        )}
        {declared.length > 0 && (
          <Stack gap="md">
            <Cluster justify="start" gap="sm" wrap>
              <Badge severity="warning">Version skew</Badge>
              <Text tone="warn" weight="semibold">
                {declared.length === 1
                  ? "1 Uplink client refused before fetch"
                  : `${declared.length} Uplink clients refused before fetch`}
              </Text>
            </Cluster>
            <Text tone="muted" size="sm">
              No bytes were fetched. The installed mod and the Hub index name
              different builds, which is what a dev-channel app and a
              release-channel mod look like from here.
            </Text>
            {declared.map((outcome) => (
              <FailedUplink key={outcome.id} outcome={outcome} override />
            ))}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
