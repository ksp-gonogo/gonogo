import type { ComponentProps } from "@gonogo/core";
import { registerComponent, useDataValue } from "@gonogo/core";
import {
  BigReadout,
  EmptyState,
  Panel,
  PanelSubtitle,
  PanelTitle,
  ReadoutCaption,
} from "@gonogo/ui";
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

/**
 * `v.crew` is documented as `string[]` ("List of crew names") in the
 * Telemachus Reborn readme. Kerbalism augments the same key with
 * per-kerbal health/stress/radiation, but gonogo doesn't support
 * Kerbalism because of the known kOS sensor incompatibility, so we
 * treat the value as a plain string array.
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
  const crewRaw = useDataValue("data", "v.crew");
  const crewCount = useDataValue("data", "v.crewCount");
  const crewCapacity = useDataValue("data", "v.crewCapacity");
  const isEVA = useDataValue("data", "v.isEVA");

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
        <PanelTitle>CREW</PanelTitle>
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
      <PanelTitle>CREW</PanelTitle>
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
  isEVA: boolean | undefined,
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
  if (!known) return <EmptyState>Waiting for telemetry…</EmptyState>;

  // Only conclude "Unmanned" once the headcount itself has arrived. If
  // `crewCapacity` (or another key) lands before `crewCount`, `known` is
  // already true but `crewCount` is still undefined — treating that as
  // unmanned flashes a wrong "no kerbals aboard" label on a crewed vessel.
  if (crewCount === undefined) {
    return <EmptyState>Waiting for telemetry…</EmptyState>;
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
      {names.map((name) => (
        <Row key={name}>
          <Bullet />
          <Name>{name}</Name>
        </Row>
      ))}
    </Roster>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

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
  dataRequirements: ["v.crew", "v.crewCount", "v.crewCapacity", "v.isEVA"],
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { CrewManifestComponent };
