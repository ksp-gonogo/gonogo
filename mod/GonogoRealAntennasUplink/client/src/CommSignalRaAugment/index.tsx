// RealAntennas augments for the base CommSignal widget.
//
// Both seats are the framework's own universal segments, which `Panel` mounts
// for every widget: `comm-signal.badges` (a chip beside the COMMNET title) and
// `comm-signal.sections` (a section at the end of the body). CommSignal itself
// neither declares nor positions them, so this enriches the readout without the
// base widget ever importing backend-aware code, and both augments read
// RealAntennas' OWN Topics only.
//
// This is where the RA integration finally RENDERS. The three RA-only channels
// (`comms.dataRate` / `comms.linkMargin` / `comms.linkQuality`) and the per-hop
// `extensions.realantennas` bag have reached the SDK end to end for a while with
// no reader; these augments are that reader.
//
// Presence-gated on `realantennas.available` via `requires: "realantennas"`: an
// install without RA never sees either augment, and CommSignal composes exactly as
// it did before.

import {
  type CommsHop,
  type Reading,
  registerAugment,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import { Badge, Cluster, Grid, Stack, Text, Unit } from "@ksp-gonogo/ui-kit";
import { readRealAntennasHopExt } from "../hopExt";
import { REALANTENNAS } from "../uplink";
// Side-effect import so the RA Topic registrations + the hop-bag hydration
// registration are alive wherever this augment is bundled.
import "../hopExt";

/**
 * The value a link-budget readout may be drawn from: current, or modelled
 * forward to the frame. A stale reading gives nothing, matching CommSignal's
 * own rule: a margin held from before a gap asserts a link that may be gone.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

/** The vessel's own first hop, whose antenna carries the link's band/tech facts. */
function primaryHop(
  hops: readonly CommsHop[] | undefined,
): CommsHop | undefined {
  return hops && hops.length > 0 ? hops[0] : undefined;
}

/** Field-label lettering, the same treatment CommSignal's own detail rows use. */
const LABEL_STYLE = {
  letterSpacing: "0.1em",
  textTransform: "uppercase" as const,
};

/**
 * Compact header chip: band + downlink rate, e.g. "X-band" alongside "262 kbps".
 * Renders nothing until RA reports a rate, so it never shows an empty chip.
 */
function CommSignalRaBadges() {
  const dataRate = judgeable(useTelemetry("comms.dataRate"));
  const path = judgeable(useTelemetry("comms.path"));
  const ext = readRealAntennasHopExt(primaryHop(path?.hops));
  const down = dataRate?.downBitsPerSec;

  if (down === undefined && !ext?.band) return null;

  return (
    // `sm` (not `xs`): the band pill and the rate value are two distinct
    // readings, not one run-on label, and `xs`'s 2px gap read as the rate
    // crowding the pill's rounded edge rather than sitting beside it.
    <Cluster gap="sm" align="center">
      {ext?.band ? <Badge severity="info">{ext.band}-band</Badge> : null}
      {down !== undefined ? (
        <Text size="xs" tone="muted">
          <Unit value={down} />
        </Text>
      ) : null}
    </Cluster>
  );
}

/**
 * The fuller RA panel: link margin (dB) and whether it closes, then the negotiated
 * modulation / encoder / tech level, then the reverse-direction rate. Each row
 * drops when its own field is absent, so a thin read never leaves a labelled blank.
 */
function CommSignalRaSection() {
  const margin = judgeable(useTelemetry("comms.linkMargin"));
  const path = judgeable(useTelemetry("comms.path"));
  const ext = readRealAntennasHopExt(primaryHop(path?.hops));

  const hasMargin = margin?.decibelMargin !== undefined;
  const hasExt =
    ext !== undefined &&
    (ext.techLevel != null ||
      ext.modulationBits != null ||
      !!ext.encoder ||
      ext.requiredEbN0 != null ||
      ext.beamwidth != null ||
      ext.reverseBitsPerSec != null);

  if (!hasMargin && !hasExt) return null;

  return (
    // Labelled "LINK BUDGET", not "RealAntennas": the operator gets the link
    // data this section presents, not which mod computed it.
    <Stack gap="xs" aria-label="Link budget detail">
      <Text size="xs" tone="muted" style={LABEL_STYLE}>
        Link budget
      </Text>
      <Grid cols="auto 1fr" gap="md" rowGap="xs" align="baseline">
        {hasMargin ? (
          <>
            <Text size="xs" tone="muted" style={LABEL_STYLE}>
              Margin
            </Text>
            {/* A margin that does not close IS the failure, so the tone is the
                verdict, named semantically and painted by the host's palette.
                "(open)" carries the same meaning without relying on colour. */}
            <Text size="sm" tone={margin?.closesLink ? "go" : "nogo"}>
              <Unit value={margin?.decibelMargin} />
              {margin?.closesLink === false ? " (open)" : null}
            </Text>
          </>
        ) : null}
        {ext?.encoder ? (
          <>
            <Text size="xs" tone="muted" style={LABEL_STYLE}>
              Encoder
            </Text>
            <Text size="sm" tone="default">
              {ext.encoder}
            </Text>
          </>
        ) : null}
        {ext?.modulationBits != null ? (
          <>
            <Text size="xs" tone="muted" style={LABEL_STYLE}>
              Modulation
            </Text>
            <Text size="sm" tone="default">
              <Unit value={ext.modulationBits} />
            </Text>
          </>
        ) : null}
        {ext?.techLevel != null ? (
          <>
            <Text size="xs" tone="muted" style={LABEL_STYLE}>
              Tech level
            </Text>
            <Text size="sm" tone="default">
              <Unit value={ext.techLevel} />
            </Text>
          </>
        ) : null}
        {ext?.requiredEbN0 != null ? (
          <>
            <Text size="xs" tone="muted" style={LABEL_STYLE}>
              Req Eb/N0
            </Text>
            <Text size="sm" tone="default">
              <Unit value={ext.requiredEbN0} />
            </Text>
          </>
        ) : null}
        {ext?.reverseBitsPerSec != null ? (
          <>
            <Text size="xs" tone="muted" style={LABEL_STYLE}>
              Uplink rate
            </Text>
            <Text size="sm" tone="default">
              <Unit value={ext.reverseBitsPerSec} />
            </Text>
          </>
        ) : null}
      </Grid>
    </Stack>
  );
}

// Stamped with the client handle, like every other registration this package
// makes. An unstamped augment belongs to nobody: the picker's mod search tags
// do not derive "realantennas" from it, and the render/docs tool reads the
// registries by owner, so it reported this Uplink as registering no augments at
// all while both were live in the bundle.
registerAugment({
  id: "realantennas-comm-signal-badge",
  augments: "comm-signal.badges",
  requires: "realantennas",
  channels: ["comms.dataRate", "comms.path"],
  component: CommSignalRaBadges,
  owner: REALANTENNAS,
});

registerAugment({
  id: "realantennas-comm-signal-section",
  augments: "comm-signal.sections",
  requires: "realantennas",
  channels: ["comms.linkMargin", "comms.path"],
  component: CommSignalRaSection,
  owner: REALANTENNAS,
});

export { CommSignalRaBadges, CommSignalRaSection };
