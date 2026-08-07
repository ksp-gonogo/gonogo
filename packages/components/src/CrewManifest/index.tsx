import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  registerComponent,
  useGameContext,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useStream, type VesselState } from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { Meter, type MeterTone } from "@ksp-gonogo/ui";
import {
  Badge,
  BigReadout,
  Cluster,
  EmptyState,
  Inline,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  Stack,
  speakQuantity,
  ToggleButton,
  Truncate,
  Unit,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  magnitudeOf,
  magnitudeOr,
  type Quantityish,
} from "../shared/magnitude";

/**
 * Tiny-mode hero readout font size. `BigReadout`'s 38px max coexists fine
 * with its caption in a roomy panel, but at the widget's 3x3 `minSize` the
 * number + stacked "OF n ABOARD" caption overflows the short panel and the
 * caption gets clipped by `Panel`'s `overflow: hidden`. We can't touch the
 * shared `BigReadout`, so this caps the number lower via an inline style
 * override and lets the centred flex box keep both lines inside the box.
 *
 * Off the type scale on purpose: this is a fluid, viewport-responsive fit,
 * and its endpoints are not independent font-size choices. The scale stops
 * at --font-size-lg (16px) and a fixed rung here would freeze the fit.
 */
const TINY_READOUT_STYLE = {
  fontSize: "clamp(20px, 4vw, 30px)",
  minHeight: 0,
} as const;

/**
 * Leading per-crew avatar cell size: a square that reserves room for an
 * avatar-face augment. Scales with the widget, clamped 36-56px (mirrors
 * `TINY_READOUT_STYLE`'s vw-clamp idiom).
 */
const AVATAR_CELL_SIZE = "clamp(36px, 8vw, 56px)";

type CrewManifestConfig = Record<string, never>;

// ── Kerbalism per-kerbal survival (additive; absent unless the KerbalismUplink
// is present, in which case the real `kerbalism.crew`/`kerbalism.lifesupport`
// Topics carry per-kerbal rule accumulators and the life-support ledger, see
// local_docs/kerbalism-fixtures). Reads the canonical `useTelemetry` Topics,
// same pattern as `LifeSupportSystems`/`SpaceWeather`; this hook is the only
// data boundary for the Kerbalism add-on. ───────────────────────────────────

/** Per-kerbal Kerbalism rule accumulators, normalized 0..1 toward fatal. */
interface KerbalRules {
  radiation?: number;
  stress?: number;
  eating?: number;
  drinking?: number;
  breathing?: number;
  climatization?: number;
  "co2 poisoning"?: number;
}

/**
 * One `kerbalism.crew[].rules[]` entry (mirrors `KerbalismCrewRule` in
 * `Sitrep.Contract`/the generated SDK contract, structurally duplicated
 * locally, matching `LifeSupportSystems`'s own `WireResource`, rather than
 * importing the generated type into a non-test file).
 */
interface KerbalismRuleWire {
  name?: string;
  /** Current accumulator ("problem") value from `KerbalData.rules`. */
  value?: Quantityish;
  /** Fatal accumulator threshold from `Profile.rules[].fatal_threshold`. */
  fatalThreshold?: Quantityish;
}

/** Every rule name the wire is known to send, mapped onto its `KerbalRules` field. */
const RULE_FIELD: Record<string, keyof KerbalRules> = {
  radiation: "radiation",
  stress: "stress",
  eating: "eating",
  drinking: "drinking",
  breathing: "breathing",
  climatization: "climatization",
  "co2 poisoning": "co2 poisoning",
};

/**
 * Normalize one wire rule's raw accumulator to a 0..1-toward-fatal fraction.
 * Kerbalism's default profile uses `fatal_threshold=1.0` for most rules but
 * overrides it per-rule (radiation's is 50), dividing by the rule's OWN
 * `fatalThreshold`, rather than assuming it's always 1, keeps every rule
 * comparable on the same 0..1 scale the meters/death-clock expect (see
 * local_docs/design/plans/2026-07-13-kerbalism-values-catalog.md).
 */
function ruleFraction(rule: KerbalismRuleWire): number {
  const accumulated = magnitudeOr(rule.value, 0);
  const threshold = magnitudeOf(rule.fatalThreshold);
  if (threshold === null || threshold <= 0) return 0;
  return Math.min(1, Math.max(0, accumulated / threshold));
}

/** Reshape one kerbal's wire `rules` array into the named `KerbalRules` the meters read. */
function toKerbalRules(rules: KerbalismRuleWire[] | undefined): KerbalRules {
  const out: KerbalRules = {};
  for (const rule of rules ?? []) {
    const field = rule.name ? RULE_FIELD[rule.name] : undefined;
    if (field) out[field] = ruleFraction(rule);
  }
  return out;
}

/**
 * Stage 1 of the two-stage death-clock: the soonest life-support resource
 * time-to-empty (amount ÷ drain-rate), the shared "time until crew start
 * dying" headline. `null` when nothing is draining.
 *
 * Across EVERY resource the loaded profile declares as a Supply, not the three
 * this used to name. That was not a judgement about which resources matter, it
 * was all the wire carried: `kerbalism.lifesupport` named four consumables as
 * fixed properties against a stock profile that runs on twelve. Under
 * ROKerbalism, whose supplies are not the stock set, the clock was reading
 * three names that profile may not even use. It now joins the rates map, the
 * generic `vessel.resources` levels, and the profile's own `isSupply` flag.
 * (Stage 2, per-kerbal accumulator-time-to-fatal after a resource hits zero,
 * needs a per-rule degeneration rate; the wire carries `degenPerSec` but the
 * mod does not yet resolve a rule's linked resource, so `deathClockSec` always
 * ships `null` today. Until then, stage 2 is shown as the "% to fatal"
 * accumulator fraction below, and this readout swaps to a precise countdown
 * then with no presentation change. See DECISIONS §CrewManifest.)
 */
function useLifeSupportTimeToEmptySec(): number | null {
  const rates = useTelemetry("kerbalism.lifesupport")?.rates;
  const levels = useTelemetry("vessel.resources")?.resources;
  // Which resources are life support is the loaded profile's call, carried as
  // `isSupply`. Without it this would have to iterate every draining resource,
  // and a burn would report LiquidFuel as the crew's time to live.
  const profile = useTelemetry("kerbalism.profile")?.resources;

  const ttes: number[] = [];
  for (const [name, rate] of Object.entries(rates ?? {})) {
    if (rate >= 0) continue;
    if (!profile?.[name]?.isSupply) continue;
    const amount = magnitudeOf(levels?.[name]?.current);
    if (amount !== null) ttes.push(amount / -rate);
  }
  return ttes.length ? Math.min(...ttes) : null;
}

/** Tone for a 0..1-toward-fatal accumulator: calm low, alarming high. */
function fatalTone(value: number): MeterTone {
  if (value >= 0.8) return "nogo";
  if (value >= 0.5) return "warn";
  return "go";
}
// A string because it feeds `valueLabel`/`label` props, not JSX children.
const pct = (v: number): string =>
  writeQuantity(value("%", v * 100), { decimals: 0 });

// -----------------------------------------------------------------------
// EVA suit resources (additive; only meaningful while the active vessel IS
// an EVA kerbal). A stock KSP EVA kerbal is a real Vessel with its own
// resource-carrying Part (Kerbalism source, System/Callbacks.cs's
// ToEVA/DelayedOnEVA on GameEvents.onCrewOnEva), so the already-existing,
// already-consumed `vessel.resources` Topic (see FuelStatus) works against
// it unchanged - no new wire protocol needed. Kerbalism's default profile
// (GameData/KerbalismConfig/Profiles/Default.cfg) attaches exactly two
// resources with a nonzero `on_eva`: ElectricCharge and Oxygen. Read here as
// plain resource-name lookups, no Kerbalism-specific shape.
// -----------------------------------------------------------------------

interface SuitResourceReadout {
  current: number;
  max: number;
}

/** Extracts a `{current, max}` pair off a `vessel.resources` entry, or
 *  `undefined` when the resource is absent or has no usable capacity. */
function toSuitResourceReadout(
  entry: { current?: Quantityish; max?: Quantityish } | undefined,
): SuitResourceReadout | undefined {
  if (!entry) return undefined;
  const current = magnitudeOf(entry.current);
  const max = magnitudeOf(entry.max);
  if (current === null || max === null || max <= 0) return undefined;
  return { current, max };
}

/** Tone for a resource fraction remaining: full tank is calm, empty is
 *  alarming - the inverse of `fatalTone`'s "toward fatal" reading. */
function suitResourceTone(fraction: number): MeterTone {
  if (fraction <= 0.15) return "nogo";
  if (fraction <= 0.4) return "warn";
  return "go";
}

/**
 * Compact EVA-suit resource block: O2 + EC meters shown only while the
 * active vessel is an EVA kerbal and the Uplink actually publishes
 * `vessel.resources` for it. Presentational (no hooks) - renders nothing
 * when neither resource is available, so an Uplink without this data leaves
 * the roster exactly as before.
 */
function EvaSuitReadout({
  oxygen,
  electricCharge,
}: Readonly<{
  oxygen: SuitResourceReadout | undefined;
  electricCharge: SuitResourceReadout | undefined;
}>) {
  if (!oxygen && !electricCharge) return null;
  return (
    <Cluster justify="start" gap="lg" wrap aria-label="EVA suit resources">
      {oxygen && (
        <Meter
          size="sm"
          label="O2"
          value={oxygen.current / oxygen.max}
          tone={suitResourceTone(oxygen.current / oxygen.max)}
          valueLabel={`${oxygen.current.toFixed(1)} / ${oxygen.max.toFixed(1)}`}
        />
      )}
      {electricCharge && (
        <Meter
          size="sm"
          label="EC"
          value={electricCharge.current / electricCharge.max}
          tone={suitResourceTone(electricCharge.current / electricCharge.max)}
          valueLabel={`${electricCharge.current.toFixed(0)} / ${electricCharge.max.toFixed(0)}`}
        />
      )}
    </Cluster>
  );
}

/**
 * The per-kerbal survival-meters block: dose + stress as 0..1-toward-fatal
 * meters, plus the derived death-clock readout. Presentational (no hooks),
 * the shared stage-1 time-to-empty is computed once in the component and passed
 * in, so this renders once per crew row without per-row subscriptions.
 */
function SurvivalMeters({
  rules,
  stage1Sec,
}: Readonly<{ rules: KerbalRules; stage1Sec: number | null }>) {
  const dose = rules.radiation ?? 0;
  const stress = rules.stress ?? 0;

  // Death-clock: while a life-support resource is draining, the headline is the
  // shared stage-1 time-to-empty. Once one is depleted (stage-1 ~0), fall back
  // to the kerbal's worst accumulator as the stage-2 "% to fatal" fraction.
  let clock: { label: string; tone: MeterTone };
  const worst = Math.max(
    dose,
    stress,
    rules.eating ?? 0,
    rules.drinking ?? 0,
    rules.breathing ?? 0,
    rules.climatization ?? 0,
    rules["co2 poisoning"] ?? 0,
  );
  if (stage1Sec !== null && stage1Sec > 60) {
    clock = {
      label: `~${speakQuantity(value("s", Math.max(0, stage1Sec)))} to LS depletion`,
      tone: "warn",
    };
  } else if (stage1Sec !== null) {
    // A resource is essentially out, degeneration is underway.
    clock = { label: `${pct(worst)} to fatal`, tone: fatalTone(worst) };
  } else {
    clock = { label: "stable", tone: "go" };
  }

  return (
    <Stack
      gap="xs"
      style={{
        paddingBottom: "var(--space-4)",
        paddingLeft: "var(--space-12)",
      }}
      aria-label="survival meters"
    >
      <Meter
        size="sm"
        label="Dose"
        value={dose}
        tone={fatalTone(dose)}
        valueLabel={pct(dose)}
      />
      <Meter
        size="sm"
        label="Stress"
        value={stress}
        tone={fatalTone(stress)}
        valueLabel={pct(stress)}
      />
      <Badge tone={clock.tone} size="sm">
        {clock.label}
      </Badge>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// The `crew-manifest.badges` slot contract (see augment-slot-map)
//
// A per-crew-row inline badges slot: a future Kerbalism `Habitat`/`Radiation`
// Uplink can badge each kerbal with comfort/radiation-dose without leaving this
// widget. Because the slot renders once PER ROW, its props MUST carry the crew
// member's identity so the augment badges the right kerbal, `crewName` is that
// identity (the only per-kerbal handle Telemachus/Sitrep exposes here), and
// `crewIndex` disambiguates in the (legal) case of two kerbals sharing a name.
// ---------------------------------------------------------------------------

/** Props passed to every `crew-manifest.badges` augment, one per crew row. */
export interface CrewBadgeContext {
  /** The crew member this badge row belongs to, its identity for the augment. */
  crewName: string;
  /** Position in the roster; disambiguates duplicate names. */
  crewIndex: number;
}

// Declaration-merge the slot id → props type into core's `SlotRegistry`.
// Co-located here (not in a shared central file) so parallel slot work in
// other widgets can't collide. Makes `registerAugment({ augments:
// "crew-manifest.badges" })` and `<AugmentSlot name="crew-manifest.badges"
// props={...} />` type-check precisely against `CrewBadgeContext`.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "crew-manifest.badges": CrewBadgeContext;
  }
}

// ---------------------------------------------------------------------------
// The `crew-manifest.avatar` slot contract (see augment-slot-map)
//
// A per-crew-row LEADING square cell (left of the name, where the bullet dot
// renders today): the SDK-independent shell of a per-kerbal avatar/portrait. An
// Uplink can register an augment that fills it with a live face, keyed by
// kerbal identity. Same per-row keying as `crew-manifest.badges`, `crewName`
// is the augment's identity handle and `crewIndex` disambiguates duplicate
// names. Whenever the augment yields nothing (no Uplink providing avatars, the
// avatar source disabled, kerbal not seated) the cell falls back to the bullet,
// so CrewManifest renders fully with the slot empty, the avatar augment is
// entirely optional.
// ---------------------------------------------------------------------------

/** Props passed to every `crew-manifest.avatar` augment, one per crew row. */
export interface CrewAvatarContext {
  /** The crew member this avatar belongs to, its identity for the augment. */
  crewName: string;
  /** Position in the roster; disambiguates duplicate names. */
  crewIndex: number;
}

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "crew-manifest.avatar": CrewAvatarContext;
  }
}

/**
 * `v.crew` is documented as `string[]` ("List of crew names") in the
 * Telemachus Reborn readme. (Historical note, kept for the object-shape
 * guard below: Telemachus-era Kerbalism installs augmented this same key
 * with per-kerbal health/stress/radiation inline; that path is superseded
 * here by the dedicated `kerbalism.crew` Topic, see the Kerbalism
 * per-kerbal survival block above, but the defensive object-shape parsing
 * stays useful for any `v.crew`-shaped source.)
 *
 * `v.crew` lives on the wire at `vessel.crew.crew`, a `CrewMember[]`
 * (`contract.ts`'s `{name?, trait?, ...}`), read here off the canonical
 * `vessel.crew` Topic. The object-shape branch below (already required for
 * the Kerbalism case) is exactly what parses `CrewMember` entries too, no
 * shape fix needed.
 *
 * Guard against unknown shapes (e.g. the server returning null before
 * the first sample or a mod replacing the payload), extract strings
 * and drop anything else.
 */
function toCrewNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && entry.trim().length > 0) out.push(entry);
    else if (entry && typeof entry === "object" && "name" in entry) {
      const name = (entry as { name: unknown }).name;
      if (typeof name === "string" && name.trim().length > 0) out.push(name);
    }
  }
  return out;
}

function CrewManifestComponent({
  w,
  h,
}: Readonly<ComponentProps<CrewManifestConfig>>) {
  // Roster, count, and capacity all ride the single `vessel.crew` Topic,
  // read it once and pick the three fields off it.
  const crew = useTelemetry("vessel.crew");
  const crewRaw = crew?.crew;
  const crewCount = crew?.count;
  const crewCapacity = crew?.capacity;
  // `v.isEVA` -> `vessel.state.isEVA`, a derived field on the `vessel.state`
  // channel (map-topic.ts), read via `useStream` like the other derived reads.
  const isEVA = useStream<VesselState>("vessel.state")?.isEVA;

  // Connectivity indicator (mirroring the WarpControl pilot): count, roster,
  // and capacity all land on the same `vessel.crew` wire channel, so
  // `v.crewCount`'s stream status is representative of the whole trio.

  // Kerbalism per-kerbal survival, additive, absent unless the KerbalismUplink
  // publishes `kerbalism.crew`. Reads happen unconditionally (stable hook
  // order); the map is empty and the meters simply never render without the
  // Uplink (canonical `useTelemetry`, so this is `undefined`, not an error,
  // when no `TelemetryProvider`/Uplink is present).
  const kerbals = useTelemetry("kerbalism.crew");
  const stage1Sec = useLifeSupportTimeToEmptySec();
  const rulesByName = new Map<string, KerbalRules>();
  if (Array.isArray(kerbals)) {
    for (const k of kerbals) {
      if (!k?.name) continue;
      const rules = toKerbalRules(k.rules);
      if (Object.keys(rules).length > 0) rulesByName.set(k.name, rules);
    }
  }
  const hasSurvival = rulesByName.size > 0;
  // Scene-aware toggle: meters default ON in Flight (where survival matters),
  // OFF elsewhere; the operator can flip that default per session.
  const { inFlight } = useGameContext();
  const [metersOverride, setMetersOverride] = useState<boolean | null>(null);
  const showMeters = hasSurvival && (metersOverride ?? inFlight);

  // EVA suit resources - additive, only relevant while the active vessel IS
  // an EVA kerbal (see the EvaSuitReadout block comment above). Read
  // unconditionally (stable hook order); undefined whenever no Uplink
  // publishes `vessel.resources` or the active vessel isn't an EVA kerbal.
  const resources = useTelemetry("vessel.resources");
  const suitOxygen = isEVA
    ? toSuitResourceReadout(resources?.resources?.Oxygen)
    : undefined;
  const suitElectricCharge = isEVA
    ? toSuitResourceReadout(resources?.resources?.ElectricCharge)
    : undefined;

  const names = toCrewNames(crewRaw);
  const known =
    crewCount !== undefined || crewCapacity !== undefined || names.length > 0;

  // Selective rendering, at very small sizes the roster is dropped in
  // favour of a single big "n / m" headcount readout.
  const cols = w ?? 6;
  const rows = h ?? 8;
  const showRoster = rows >= 5 && cols >= 4;

  if (!showRoster) {
    return (
      <Panel panelTitle="CREW">
        {known ? (
          <BigReadout $tone="go" style={TINY_READOUT_STYLE}>
            {crewCount !== undefined ? (
              <Unit value={crewCount} />
            ) : (
              NULL_DISPLAY
            )}
            {crewCapacity !== undefined && (
              <ReadoutCaption>
                of <Unit value={crewCapacity} /> aboard
              </ReadoutCaption>
            )}
          </BigReadout>
        ) : (
          <EmptyState>No crew data</EmptyState>
        )}
      </Panel>
    );
  }

  const crewSummary = known
    ? formatSubtitle(isEVA, crewCount?.magnitude, crewCapacity?.magnitude)
    : "";

  return (
    <Panel
      panelTitle="CREW"
      panelAside={
        hasSurvival ? (
          <ToggleButton
            size="sm"
            active={showMeters}
            onClick={() => setMetersOverride(!showMeters)}
          >
            {showMeters ? "Hide meters" : "Show meters"}
          </ToggleButton>
        ) : undefined
      }
    >
      {/* Crew summary relocated out of the panel subtitle into the body
          (staging change), carried by ui-kit's ReadoutCaption. */}
      {crewSummary && <ReadoutCaption>{crewSummary}</ReadoutCaption>}
      <EvaSuitReadout oxygen={suitOxygen} electricCharge={suitElectricCharge} />
      {renderBody({
        known,
        crewCount: crewCount?.magnitude,
        names,
        showMeters,
        rulesByName,
        stage1Sec,
      })}
    </Panel>
  );
}

function formatSubtitle(
  isEVA: boolean | null | undefined,
  crewCount: number | undefined,
  crewCapacity: number | undefined,
): string {
  const parts: string[] = [];
  if (isEVA === true) parts.push("EVA");
  if (crewCount !== undefined && crewCapacity !== undefined) {
    parts.push(`${crewCount} / ${crewCapacity} aboard`);
  } else if (crewCount !== undefined) {
    parts.push(`${crewCount} aboard`);
  }
  return parts.join(" · ");
}

function renderBody({
  known,
  crewCount,
  names,
  showMeters,
  rulesByName,
  stage1Sec,
}: {
  known: boolean;
  crewCount: number | undefined;
  names: string[];
  showMeters: boolean;
  rulesByName: Map<string, KerbalRules>;
  stage1Sec: number | null;
}): React.ReactNode {
  if (!known) return <EmptyState>Waiting for telemetry...</EmptyState>;

  // Only conclude "Unmanned" once the headcount itself has arrived. If
  // `crewCapacity` (or another key) lands before `crewCount`, `known` is
  // already true but `crewCount` is still undefined, treating that as
  // unmanned flashes a wrong "no kerbals aboard" label on a crewed vessel.
  if (crewCount === undefined) {
    return <EmptyState>Waiting for telemetry...</EmptyState>;
  }

  if (crewCount === 0) {
    return <EmptyState>Unmanned, no kerbals aboard.</EmptyState>;
  }

  const rosterListStyle = {
    listStyle: "none",
    margin: "var(--space-8) 0 0",
    padding: 0,
  } as const;

  if (names.length === 0) {
    return (
      <Stack as="ul" gap="sm" style={rosterListStyle}>
        <EmptyState>
          {crewCount} aboard, names unavailable. Telemachus may withhold crew
          names when out of CommNet range.
        </EmptyState>
      </Stack>
    );
  }

  return (
    <Stack as="ul" gap="sm" style={rosterListStyle}>
      {names.map((name, index) => {
        const rules = showMeters ? rulesByName.get(name) : undefined;
        return (
          <Stack as="li" gap="sm" key={name}>
            <Cluster justify="start">
              {/* Leading per-crew avatar slot: a square cell where an Uplink's
                  avatar augment composes. The fallback bullet is a base
                  layer under the slot, with no augment bound (or the augment
                  yielding nothing: no Uplink, facecams off, kerbal not seated)
                  it shows through, so the roster degrades gracefully. */}
              <CrewAvatarCell
                fallback={
                  <div
                    data-testid="crew-avatar-fallback"
                    aria-hidden
                    style={AVATAR_LAYER_STYLE}
                  >
                    <CrewBullet />
                  </div>
                }
                slot={
                  <div style={AVATAR_LAYER_STYLE}>
                    {/* Forces whatever the augment renders (e.g. a face
                        image) to fill the cell, matching the fallback's
                        own centred sizing. */}
                    <div style={{ width: "100%", height: "100%" }}>
                      <AugmentSlot
                        name="crew-manifest.avatar"
                        props={{ crewName: name, crewIndex: index }}
                      />
                    </div>
                  </div>
                }
              />
              <Truncate>{name}</Truncate>
              {/* Per-crew inline badges slot. Renders nothing until an Uplink
                  (e.g. Kerbalism Habitat/Radiation) binds, the props carry
                  this row's kerbal identity so the augment badges the right
                  one. */}
              <Inline gap="xs" style={{ marginLeft: "auto" }}>
                <AugmentSlot
                  name="crew-manifest.badges"
                  props={{ crewName: name, crewIndex: index }}
                />
              </Inline>
            </Cluster>
            {rules && <SurvivalMeters rules={rules} stage1Sec={stage1Sec} />}
          </Stack>
        );
      })}
    </Stack>
  );
}

// ── Avatar cell ──────────────────────────────────────────────────────────────

// Both layers absolutely fill the avatar cell and centre their content, so
// the fallback bullet and a live augment face stack in the same box.
const AVATAR_LAYER_STYLE = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
} as const;

/**
 * Leading per-crew avatar cell: a square that reserves room for an avatar-face
 * augment, sized via `AVATAR_CELL_SIZE`. `position: relative` so the fallback
 * and the augment slot layers stack in the same box.
 */
function CrewAvatarCell({
  fallback,
  slot,
}: Readonly<{ fallback: ReactNode; slot: ReactNode }>) {
  return (
    <div
      style={{
        position: "relative",
        flex: "0 0 auto",
        width: AVATAR_CELL_SIZE,
        height: AVATAR_CELL_SIZE,
      }}
    >
      {fallback}
      {slot}
    </div>
  );
}

// Base layer: the bullet dot, centred in the avatar cell. Shows whenever the
// slot yields nothing (no augment / facecams off / kerbal not seated); an
// augment paints over it. Decorative, the name carries the identity.
function CrewBullet() {
  return (
    <span
      style={{
        display: "block",
        width: "6px",
        height: "6px",
        borderRadius: "var(--radius-circle)",
        background: "var(--color-accent-fg)",
      }}
    />
  );
}

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<CrewManifestConfig>({
  id: "crew-manifest",
  name: "Crew Manifest",
  description:
    "Kerbals aboard the active vessel, count vs capacity + full roster. Shows EVA state and handles unmanned probes gracefully.",
  tags: ["telemetry", "crew"],
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 3, h: 3 },
  component: CrewManifestComponent,
  // Per-crew-row augment slots (augment-slot-map). Both unfilled until an Uplink
  // binds, the roster renders as before:
  //   crew-manifest.badges, trailing inline badges (e.g. Kerbalism dose/comfort)
  //   crew-manifest.avatar, leading square face cell (Uplink-provided avatar), falls
  //     back to the bullet when empty.
  augmentSlots: ["crew-manifest.badges", "crew-manifest.avatar"],
  dataRequirements: ["v.crew", "v.crewCount", "v.crewCapacity", "v.isEVA"],
  // Kerbalism per-kerbal survival, additive, present only with the
  // KerbalismUplink. `optionalChannels` (not `channels`): the widget's core
  // roster reads always work without Kerbalism, so these must never gate the
  // whole widget's mount the way a REQUIRED `channels` entry would (see
  // `RequiresGuard`'s own doc comment on the distinction). `kerbalism.crew`
  // carries the rule accumulators; `kerbalism.lifesupport` drives the shared
  // stage-1 death-clock. `vessel.resources` is the (already-existing,
  // already-consumed-by-FuelStatus) generic per-vessel resource Topic; here
  // it feeds the EVA suit O2/EC readout, only relevant while the active
  // vessel is an EVA kerbal.
  optionalChannels: [
    "kerbalism.crew",
    "kerbalism.lifesupport",
    "vessel.resources",
  ],
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { CrewManifestComponent };
