import type { ComponentProps } from "@gonogo/core";
import { registerComponent, useDataValue } from "@gonogo/core";
import { Panel, PanelSubtitle, PanelTitle } from "@gonogo/ui";
import styled from "styled-components";

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

function CrewManifestComponent(
  _: Readonly<ComponentProps<CrewManifestConfig>>,
) {
  const crewRaw = useDataValue("data", "v.crew");
  const crewCount = useDataValue("data", "v.crewCount");
  const crewCapacity = useDataValue("data", "v.crewCapacity");
  const isEVA = useDataValue("data", "v.isEVA");

  const names = toCrewNames(crewRaw);
  const known =
    crewCount !== undefined || crewCapacity !== undefined || names.length > 0;

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
  if (!known) return <Empty>Waiting for telemetry…</Empty>;

  const unmanned =
    crewCount === 0 || (crewCount === undefined && names.length === 0);
  if (unmanned) return <Empty>Unmanned — no kerbals aboard.</Empty>;

  if (names.length === 0) {
    return (
      <Roster>
        <Empty>
          {crewCount} aboard, names unavailable. Telemachus may withhold crew
          names when out of CommNet range.
        </Empty>
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

const Empty = styled.div`
  color: #555;
  font-family: monospace;
  font-size: var(--font-size-sm, 11px);
  padding: 8px 0;
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
  background: #4caf50;
  flex: 0 0 auto;
`;

const Name = styled.span`
  font-family: monospace;
  font-size: var(--font-size-base, 13px);
  color: #ccc;
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
  component: CrewManifestComponent,
  dataRequirements: ["v.crew", "v.crewCount", "v.crewCapacity", "v.isEVA"],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { CrewManifestComponent };
