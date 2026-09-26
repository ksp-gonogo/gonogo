import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  defineTopicManifest,
  getAugmentsForSlot,
  registerComponent,
  useContributions,
} from "@ksp-gonogo/core";
import type { TopicReading } from "@ksp-gonogo/sitrep-client";
import type { Reading, Value, VesselResources } from "@ksp-gonogo/sitrep-sdk";
import { stillTrue, VesselType } from "@ksp-gonogo/sitrep-sdk";
import { Meter, type MeterTone } from "@ksp-gonogo/ui";
import {
  BigReadout,
  Card,
  Cluster,
  EmptyState,
  FramedDisplay,
  Inline,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  type ReadoutTone,
  Section,
  Stack,
  Truncate,
  Unit,
  useElementSize,
  WidgetMeters,
} from "@ksp-gonogo/ui-kit";
import { type ReactNode, useMemo } from "react";
// Registers the header headcount badge.
import "./badge";

const topics = defineTopicManifest({
  channels: ["vessel.crew", "vessel.identity"],
  optionalChannels: ["vessel.resources"],
  fields: [
    "vessel.crew.crew",
    "vessel.crew.count",
    "vessel.crew.capacity",
    "vessel.identity.vesselType",
  ],
});

/** Caps the tiny-mode hero readout so the number and its caption both fit a 3x3 panel. Fluid on purpose, so it sits off the type scale. */
const TINY_READOUT_STYLE = {
  fontSize: "clamp(20px, 4vw, 30px)",
  minHeight: 0,
} as const;

/** Avatar cell bounds. Sized off the roster's measured width, not the viewport, since a tile's width has no fixed relation to the window. */
const AVATAR_CELL_MIN_PX = 36;
const AVATAR_CELL_MAX_PX = 56;
/** Fraction of the measured roster width the avatar cell targets before clamping. */
const AVATAR_CELL_WIDTH_FRACTION = 0.2;
/** Seed width until the first measurement lands: the default 6-column width, so first paint is mid-range. */
const AVATAR_MEASURE_SEED = { w: 232, h: 0 };

function avatarCellSizePx(containerWidthPx: number): number {
  return Math.round(
    Math.min(
      AVATAR_CELL_MAX_PX,
      Math.max(
        AVATAR_CELL_MIN_PX,
        containerWidthPx * AVATAR_CELL_WIDTH_FRACTION,
      ),
    ),
  );
}

type CrewStatusConfig = Record<string, never>;

// An EVA kerbal is a real vessel, so its suit resources arrive on `vessel.resources`; the install's life-support profile decides which ones.

/** A resource's amount and capacity as field readings, or `undefined` when the vessel has no tank for it, the one structural absence that hides the meter. */
function suitTank(
  reading: TopicReading<VesselResources>,
  name: string,
): SuitTank | undefined {
  const carried =
    reading.state === "observed" || reading.state === "stale"
      ? reading.value?.resources?.[name]
      : undefined;
  if (!carried) return undefined;
  const entry = reading.resources[name];
  return { amount: entry.current, capacity: entry.max };
}

interface SuitTank {
  amount: Reading<Value<"units">>;
  capacity: Reading<Value<"units">>;
}

/** Tone for what is left in a suit tank: full is calm, empty alarms. `undefined` when either half has no figure. */
function suitResourceTone(pair: SuitTank): MeterTone | undefined {
  const amount = pair.amount.value;
  const capacity = pair.capacity.value;
  if (!amount || !capacity?.isPositive()) return undefined;
  const fraction = amount.dividedBy(capacity).magnitude;
  if (fraction <= 0.15) return "nogo";
  if (fraction <= 0.4) return "warn";
  return "go";
}

/** O2 and EC meters for an EVA kerbal; renders nothing when neither resource is carried. */
function EvaSuitReadout({
  oxygen,
  electricCharge,
}: Readonly<{
  oxygen: SuitTank | undefined;
  electricCharge: SuitTank | undefined;
}>) {
  if (!oxygen && !electricCharge) return null;
  return (
    <Cluster justify="start" wrap aria-label="EVA suit resources">
      {oxygen && (
        <Meter
          label="O2"
          value={oxygen.amount}
          capacity={oxygen.capacity}
          tone={suitResourceTone(oxygen)}
        />
      )}
      {electricCharge && (
        <Meter
          label="EC"
          value={electricCharge.amount}
          capacity={electricCharge.capacity}
          tone={suitResourceTone(electricCharge)}
        />
      )}
    </Cluster>
  );
}

// `crew-status.row-badges`: per-row inline badges keyed by `crewName`, with `crewIndex` disambiguating shared names. Not `.badges`, which is the framework's own contribution slot.

/** Props passed to every `crew-status.row-badges` augment, one per crew row. */
export interface CrewBadgeContext {
  /** The crew member this badge row belongs to, its identity for the augment. */
  crewName: string;
  /** Position in the roster; disambiguates duplicate names. */
  crewIndex: number;
}

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "crew-status.row-badges": CrewBadgeContext;
  }
}

// `crew-status.avatar`: a per-row leading avatar cell keyed like `.row-badges`, reserved only while an Uplink binds it and blank for a kerbal it has nothing for.

/** Props passed to every `crew-status.avatar` augment, one per crew row. */
export interface CrewAvatarContext {
  /** The crew member this avatar belongs to, its identity for the augment. */
  crewName: string;
  /** Position in the roster; disambiguates duplicate names. */
  crewIndex: number;
}

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "crew-status.avatar": CrewAvatarContext;
  }
}

// Per-row survival meters are the framework's `crew-status.meters` contribution segment, addressed to a kerbal by `row`.

/*
 * `crew-status.row-tone`: data rather than JSX, because the tinted `Card` wraps the whole row and no augment can reach it.
 * A contributor names a severity; the host owns the palette. First entry per name wins.
 */

/** One entry of a `crew-status.row-tone` contribution: how alarming this
 *  kerbal's situation is, or omit the kerbal entirely for "nothing to
 *  report". */
export interface CrewRowToneEntry {
  /** The crew member this entry is about; matched against the roster row by name. */
  crewName: string;
  /** How alarming the situation is. The host decides what that looks like. */
  severity: "info" | "warning" | "critical";
}

declare module "@ksp-gonogo/core" {
  interface ContributionRegistry {
    "crew-status.row-tone": {
      entry: CrewRowToneEntry;
      topics: "vessel.crew";
    };
  }
}

/** The host's palette decision, and the only one: a contributor's severity
 *  becomes the `Card` tone here and nowhere else. */
const ROW_TONE_BY_SEVERITY: Record<CrewRowToneEntry["severity"], ReadoutTone> =
  {
    info: "default",
    warning: "warning",
    critical: "alert",
  };

// `crew-status.summary`: one whole-widget section above the roster for crew-wide status, with no per-kerbal props.

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "crew-status.summary": Record<string, never>;
  }
}

/** Crew names from `vessel.crew.crew`, accepting bare strings or `{ name }` objects and dropping anything else. */
function toCrewNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const entries: unknown[] = raw;
  const out: string[] = [];
  for (const entry of entries) {
    if (typeof entry === "string" && entry.trim().length > 0) out.push(entry);
    else if (typeof entry === "object" && entry !== null) {
      const name: unknown = Reflect.get(entry, "name");
      if (typeof name === "string" && name.trim().length > 0) out.push(name);
    }
  }
  return out;
}

function CrewStatusComponent({
  w,
  h,
}: Readonly<ComponentProps<CrewStatusConfig>>) {
  // A held roster is still the crew: nobody leaves the capsule because the link dropped.
  const crewReading = topics.useTelemetry("vessel.crew");
  const crew = stillTrue(crewReading, undefined);
  const crewRaw = crew?.crew;
  const crewCount = crew?.count;
  const crewCapacity = crew?.capacity;
  // Whether the crew is outside is a fact about the craft, so it holds while the link is quiet exactly as the roster beside it does.
  const identity = stillTrue(topics.useTelemetry("vessel.identity"), undefined);
  const isEVA =
    identity === undefined ? undefined : identity.vesselType === VesselType.EVA;

  // Suit resources are never held like the roster: they only fall, so a stale figure is drawn marked, never as current.
  const resourcesReading = topics.useTelemetry("vessel.resources");
  const suitOxygen = isEVA ? suitTank(resourcesReading, "Oxygen") : undefined;
  const suitElectricCharge = isEVA
    ? suitTank(resourcesReading, "ElectricCharge")
    : undefined;

  const { ref: rosterWidthRef, size: rosterSize } =
    useElementSize<HTMLDivElement>(AVATAR_MEASURE_SEED);
  const avatarSizePx = avatarCellSizePx(rosterSize.w);

  const rowToneContributions = useContributions("crew-status.row-tone");
  const rowToneByName = useMemo(() => {
    const map = new Map<string, ReadoutTone>();
    for (const entry of rowToneContributions) {
      if (!map.has(entry.crewName)) {
        map.set(entry.crewName, ROW_TONE_BY_SEVERITY[entry.severity]);
      }
    }
    return map;
  }, [rowToneContributions]);

  // Read here as well as in `WidgetMeters` so the EVA solo-row check can see this kerbal's meters.
  const meterContributions = useContributions("meters");

  const names = toCrewNames(crewRaw);
  const known =
    crewCount !== undefined || crewCapacity !== undefined || names.length > 0;

  // Selective rendering, at very small sizes the roster is dropped in favour of a single big "n / m" headcount readout.
  const cols = w ?? 6;
  const rows = h ?? 8;
  const showRoster = rows >= 5 && cols >= 4;

  if (!showRoster) {
    return (
      <Panel
        panelTitle="CREW"
        sections={
          <Section>
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
          </Section>
        }
      />
    );
  }

  // The headcount lives in the header badge; this line carries only the EVA marker.
  const crewSummary = known && isEVA === true ? "EVA" : "";

  // On EVA the header names the kerbal; with no single resolved name yet it falls back to a bare "EVA".
  const evaKerbalName =
    known && isEVA === true && names.length === 1 ? names[0] : undefined;

  // A Card showing only the name the header already carries is an empty box, so it is dropped unless something else is bound to that row.
  const evaRowHasBoundContent =
    evaKerbalName !== undefined &&
    (getAugmentsForSlot("crew-status.avatar").length > 0 ||
      getAugmentsForSlot("crew-status.row-badges").length > 0 ||
      rowToneByName.has(evaKerbalName) ||
      meterContributions.some((entry) => entry.row === evaKerbalName));

  return (
    <Panel
      panelTitle="CREW"
      sections={
        <Section>
          <AugmentSlot name="crew-status.summary" props={{}} />
          {evaKerbalName ? (
            <ReadoutCaption>{evaKerbalName} · EVA</ReadoutCaption>
          ) : (
            crewSummary && <ReadoutCaption>{crewSummary}</ReadoutCaption>
          )}
          <EvaSuitReadout
            oxygen={suitOxygen}
            electricCharge={suitElectricCharge}
          />
          <div ref={rosterWidthRef}>
            {renderBody({
              known,
              crewCount: crewCount?.magnitude,
              names,
              avatarSizePx,
              rowToneByName,
              omitCardFor:
                evaKerbalName !== undefined && !evaRowHasBoundContent
                  ? evaKerbalName
                  : undefined,
              suppressNameFor: evaRowHasBoundContent
                ? evaKerbalName
                : undefined,
            })}
          </div>
        </Section>
      }
    />
  );
}

function renderBody({
  known,
  crewCount,
  names,
  avatarSizePx,
  rowToneByName,
  omitCardFor,
  suppressNameFor,
}: {
  known: boolean;
  crewCount: number | undefined;
  names: string[];
  avatarSizePx: number;
  rowToneByName: ReadonlyMap<string, ReadoutTone>;
  /** Skip this row's Card entirely: the EVA header already named this
   *  kerbal and nothing else is bound to their row. */
  omitCardFor?: string;
  /** Keep this row's Card, but drop its name text: the EVA header already
   *  named this kerbal, and the Card still has other content to show. */
  suppressNameFor?: string;
}): React.ReactNode {
  if (!known) return <EmptyState>Waiting for telemetry...</EmptyState>;

  // Only conclude "Unmanned" once the headcount itself has arrived; capacity can land first.
  if (crewCount === undefined) {
    return <EmptyState>Waiting for telemetry...</EmptyState>;
  }

  if (crewCount === 0) {
    return <EmptyState>Unmanned, no kerbals aboard.</EmptyState>;
  }

  const rosterListStyle = {
    listStyle: "none",
    margin: "var(--gap-related-comfortable) 0 0",
    padding: 0,
    /* Wider than the gap inside each Card, so rows read as separate surfaces. */
    gap: "var(--gap-section)",
  } as const;

  if (names.length === 0) {
    return (
      <Stack as="ul" style={rosterListStyle}>
        <EmptyState>
          {crewCount} aboard, names unavailable. Crew names can be withheld when
          the vessel is out of CommNet range.
        </EmptyState>
      </Stack>
    );
  }

  // Augments register at module load, so a non-reactive read is enough.
  const avatarAugmentPresent =
    getAugmentsForSlot("crew-status.avatar").length > 0;

  return (
    <Stack as="ul" style={rosterListStyle}>
      {names.map((name, index) => {
        if (name === omitCardFor) return null;
        const suppressName = name === suppressNameFor;
        return (
          <Card
            as="li"
            key={name}
            tone={rowToneByName.get(name)}
            // The row's identity for assistive tech while its visible name is suppressed.
            aria-label={suppressName ? name : undefined}
            /* The avatar is a visual, so it sits in a framed left aside; the aside sets the frame's corner. */
            left={
              avatarAugmentPresent ? (
                <CrewAvatarCell
                  sizePx={avatarSizePx}
                  slot={
                    <div style={AVATAR_LAYER_STYLE}>
                      <div style={{ width: "100%", height: "100%" }}>
                        <AugmentSlot
                          name="crew-status.avatar"
                          props={{ crewName: name, crewIndex: index }}
                        />
                      </div>
                    </div>
                  }
                />
              ) : undefined
            }
          >
            {/* Composed in the body, not via `title`, so the avatar aside sits beside the name rather than under it. The name's `flex: 1 1 auto` lets a trailing badge wrap instead of truncating it. */}
            <Card.TitleRow
              right={
                <Inline>
                  <AugmentSlot
                    name="crew-status.row-badges"
                    props={{ crewName: name, crewIndex: index }}
                  />
                </Inline>
              }
            >
              {!suppressName && (
                <Card.Title>
                  <Truncate style={NAME_FLEX_STYLE}>{name}</Truncate>
                </Card.Title>
              )}
            </Card.TitleRow>
            <WidgetMeters row={name} style={CREW_METERS_STYLE} />
          </Card>
        );
      })}
    </Stack>
  );
}

// The augment slot layer fills the avatar cell and centres its content.
const AVATAR_LAYER_STYLE = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
} as const;

/** Lets a trailing badge wrap rather than shrinking the name into an ellipsis. */
const NAME_FLEX_STYLE = { flex: "1 1 auto" } as const;

/** Indents a row's contributed meters under the kerbal's name, and keeps a gap
 *  before the next roster row. Carried on the stack itself rather than on a
 *  wrapper here, so a kerbal with no meters leaves no padding behind. */
const CREW_METERS_STYLE = {
  paddingBottom: "var(--gap-crew-meters)",
  paddingLeft: "var(--indent-row)",
} as const;

/** Framed square for the avatar augment; `position: relative` so the slot layer fills it. */
function CrewAvatarCell({
  slot,
  sizePx,
}: Readonly<{ slot: ReactNode; sizePx: number }>) {
  return (
    <FramedDisplay
      data-testid="crew-avatar-cell"
      style={{
        position: "relative",
        flex: "0 0 auto",
        width: `${sizePx}px`,
        height: `${sizePx}px`,
      }}
    >
      {slot}
    </FramedDisplay>
  );
}

registerComponent<CrewStatusConfig>({
  id: "crew-status",
  name: "Crew Status",
  description:
    "Kerbals aboard the active vessel, count vs capacity + full roster. Shows EVA state and handles unmanned probes gracefully.",
  tags: ["telemetry", "crew"],
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 3, h: 3 },
  component: CrewStatusComponent,
  augmentSlots: [
    "crew-status.row-badges",
    "crew-status.avatar",
    "crew-status.summary",
  ],
  contributionSlots: ["crew-status.row-tone"],
  channels: topics.channels,
  fields: topics.fields,
  optionalChannels: topics.optionalChannels,
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { CrewStatusComponent };
