import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  registerComponent,
  useDataStreamStatus,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useStream, type VesselState } from "@ksp-gonogo/sitrep-client";
import {
  BigReadout,
  EmptyState,
  Panel,
  PanelSubtitle,
  PanelTitle,
  ReadoutCaption,
  StreamStatusBadge,
} from "@ksp-gonogo/ui";
import styled from "styled-components";

/**
 * Tiny-mode hero readout. `BigReadout`'s 38px max coexists fine with its
 * caption in a roomy panel, but at the widget's 3x3 `minSize` the number +
 * stacked "OF n ABOARD" caption overflows the short panel and the caption
 * gets clipped by `Panel`'s `overflow: hidden`. We can't touch the shared
 * `BigReadout`, so cap the number lower here and let the centred flex box
 * keep both lines inside the box.
 */
const TinyReadout = styled(BigReadout)`
  font-size: clamp(20px, 4vw, 30px);
  min-height: 0;
`;

type CrewManifestConfig = Record<string, never>;

// ---------------------------------------------------------------------------
// The `crew-manifest.badges` slot contract (see augment-slot-map)
//
// A per-crew-row inline badges slot: a future Kerbalism `Habitat`/`Radiation`
// Uplink can badge each kerbal with comfort/radiation-dose without leaving this
// widget. Because the slot renders once PER ROW, its props MUST carry the crew
// member's identity so the augment badges the right kerbal — `crewName` is that
// identity (the only per-kerbal handle Telemachus/Sitrep exposes here), and
// `crewIndex` disambiguates in the (legal) case of two kerbals sharing a name.
// ---------------------------------------------------------------------------

/** Props passed to every `crew-manifest.badges` augment — one per crew row. */
export interface CrewBadgeContext {
  /** The crew member this badge row belongs to — its identity for the augment. */
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

/**
 * `v.crew` is documented as `string[]` ("List of crew names") in the
 * Telemachus Reborn readme. Kerbalism augments the same key with
 * per-kerbal health/stress/radiation, but gonogo doesn't support
 * Kerbalism because of the known kOS sensor incompatibility, so we
 * treat the value as a plain string array.
 *
 * `v.crew` lives on the wire at `vessel.crew.crew`, a `CrewMember[]`
 * (`contract.ts`'s `{name?, trait?, ...}`), read here off the canonical
 * `vessel.crew` Topic. The object-shape branch below (already required for
 * the Kerbalism case) is exactly what parses `CrewMember` entries too — no
 * shape fix needed.
 *
 * Guard against unknown shapes (e.g. the server returning null before
 * the first sample or a mod replacing the payload) — extract strings
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
  // Roster, count, and capacity all ride the single `vessel.crew` Topic —
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
  const streamStatus = useDataStreamStatus("data", "v.crewCount");

  const names = toCrewNames(crewRaw);
  const known =
    crewCount !== undefined || crewCapacity !== undefined || names.length > 0;

  // Selective rendering — at very small sizes the roster is dropped in
  // favour of a single big "n / m" headcount readout.
  const cols = w ?? 6;
  const rows = h ?? 8;
  const showRoster = rows >= 5 && cols >= 4;

  if (!showRoster) {
    return (
      <Panel>
        <TitleRow>
          <PanelTitle>CREW</PanelTitle>
          <StreamStatusBadge status={streamStatus} />
        </TitleRow>
        {known ? (
          <TinyReadout $tone="go">
            {crewCount !== undefined ? `${crewCount}` : "—"}
            {crewCapacity !== undefined && (
              <ReadoutCaption>of {crewCapacity} aboard</ReadoutCaption>
            )}
          </TinyReadout>
        ) : (
          <EmptyState>No crew data</EmptyState>
        )}
      </Panel>
    );
  }

  return (
    <Panel>
      <TitleRow>
        <PanelTitle>CREW</PanelTitle>
        <StreamStatusBadge status={streamStatus} />
      </TitleRow>
      <PanelSubtitle>
        {known
          ? formatSubtitle(isEVA, crewCount, crewCapacity)
          : "No crew data"}
      </PanelSubtitle>
      {renderBody({ known, crewCount, names })}
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
}: {
  known: boolean;
  crewCount: number | undefined;
  names: string[];
}): React.ReactNode {
  if (!known) return <EmptyState>Waiting for telemetry...</EmptyState>;

  // Only conclude "Unmanned" once the headcount itself has arrived. If
  // `crewCapacity` (or another key) lands before `crewCount`, `known` is
  // already true but `crewCount` is still undefined — treating that as
  // unmanned flashes a wrong "no kerbals aboard" label on a crewed vessel.
  if (crewCount === undefined) {
    return <EmptyState>Waiting for telemetry...</EmptyState>;
  }

  if (crewCount === 0) {
    return <EmptyState>Unmanned — no kerbals aboard.</EmptyState>;
  }

  if (names.length === 0) {
    return (
      <Roster>
        <EmptyState>
          {crewCount} aboard, names unavailable. Telemachus may withhold crew
          names when out of CommNet range.
        </EmptyState>
      </Roster>
    );
  }

  return (
    <Roster>
      {names.map((name, index) => (
        <Row key={name}>
          <Bullet />
          <Name>{name}</Name>
          {/* Per-crew inline badges slot. Renders nothing until an Uplink (e.g.
              Kerbalism Habitat/Radiation) binds — the props carry this row's
              kerbal identity so the augment badges the right one. */}
          <Badges>
            <AugmentSlot
              name="crew-manifest.badges"
              props={{ crewName: name, crewIndex: index }}
            />
          </Badges>
        </Row>
      ))}
    </Roster>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
`;

const Roster = styled.ul`
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Row = styled.li`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const Bullet = styled.span`
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-accent-fg);
  flex: 0 0 auto;
`;

const Name = styled.span`
  font-size: var(--font-size-base);
  color: var(--color-text-primary);
  letter-spacing: 0.02em;
`;

// Inline container for the per-crew `crew-manifest.badges` augment slot. Sits
// after the name, pushed to the row's trailing edge; empty (no augment bound)
// it collapses and adds nothing to the row.
const Badges = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<CrewManifestConfig>({
  id: "crew-manifest",
  name: "Crew Manifest",
  description:
    "Kerbals aboard the active vessel — count vs capacity + full roster. Shows EVA state and handles unmanned probes gracefully.",
  tags: ["telemetry", "crew"],
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 3, h: 3 },
  component: CrewManifestComponent,
  // Per-crew-row inline badges slot (augment-slot-map: crew-manifest.badges).
  // Unfilled until a Kerbalism-style Uplink binds — the roster renders as before.
  augmentSlots: ["crew-manifest.badges"],
  dataRequirements: ["v.crew", "v.crewCount", "v.crewCapacity", "v.isEVA"],
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { CrewManifestComponent };
