import type { ComponentProps } from "@gonogo/core";
import { registerComponent, useDataValue } from "@gonogo/core";
import {
  Badge,
  Panel,
  PanelSubtitle,
  PanelTitle,
  ScrollArea,
} from "@gonogo/ui";
import styled from "styled-components";

type StaffRosterConfig = Record<string, never>;

export interface StaffMember {
  name: string;
  trait: string;
  experienceLevel: number;
  available: boolean;
  unavailableReason: string;
  // Expanded fields from kc.crewRoster — additive, default to safe
  // zero/false when the older Telemachus DLL is loaded.
  veteran: boolean;
  isBadass: boolean;
  careerFlights: number;
  courage: number;
  stupidity: number;
  currentVesselName: string;
}

/**
 * Defensive parser for `kc.crewRoster` from the GonogoTelemetry plugin.
 * Mirrors the shape used by the Launch Director's crew picker — same
 * payload, different consumer. Drops malformed entries; preserves the
 * `unavailableReason` string for tooltips on greyed rows.
 */
export function parseStaff(raw: unknown): StaffMember[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: StaffMember[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name : null;
    if (!name) continue;
    out.push({
      name,
      trait: typeof e.trait === "string" ? e.trait : "",
      experienceLevel:
        typeof e.experienceLevel === "number" ? e.experienceLevel : 0,
      available: e.available === true,
      unavailableReason:
        typeof e.unavailableReason === "string" ? e.unavailableReason : "",
      veteran: e.veteran === true,
      isBadass: e.isBadass === true,
      careerFlights: typeof e.careerFlights === "number" ? e.careerFlights : 0,
      courage: typeof e.courage === "number" ? e.courage : 0,
      stupidity: typeof e.stupidity === "number" ? e.stupidity : 0,
      currentVesselName:
        typeof e.currentVesselName === "string" ? e.currentVesselName : "",
    });
  }
  return out;
}

const TRAIT_ORDER = ["Pilot", "Engineer", "Scientist", "Tourist"] as const;
const TRAIT_RANK: Record<string, number> = TRAIT_ORDER.reduce(
  (acc, t, i) => {
    acc[t] = i;
    return acc;
  },
  {} as Record<string, number>,
);

// Tooltip stitched from the expanded kc.crewRoster fields. Includes
// courage/stupidity (which we don't render as primary chrome to keep
// the row compact) and the current-vessel attribution for assigned
// kerbals — useful context the row otherwise loses.
function buildTooltip(k: StaffMember): string {
  const parts: string[] = [];
  parts.push(`${k.trait || "—"} · L${k.experienceLevel}`);
  if (k.careerFlights > 0) parts.push(`${k.careerFlights} flight(s)`);
  parts.push(`courage ${Math.round(k.courage * 100)}`);
  parts.push(`stupidity ${Math.round(k.stupidity * 100)}`);
  if (k.veteran) parts.push("veteran");
  if (k.isBadass) parts.push("badass");
  if (!k.available && k.unavailableReason) {
    if (k.currentVesselName)
      parts.push(`${k.unavailableReason} (${k.currentVesselName})`);
    else parts.push(k.unavailableReason);
  }
  return parts.join(" · ");
}

function sortStaff(roster: StaffMember[]): StaffMember[] {
  // Available kerbals first, then by trait (Pilot/Eng/Sci/Tourist), then
  // by experience desc, then alphabetical. Stable for equal keys.
  return [...roster].sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    const ar = TRAIT_RANK[a.trait] ?? 99;
    const br = TRAIT_RANK[b.trait] ?? 99;
    if (ar !== br) return ar - br;
    if (a.experienceLevel !== b.experienceLevel)
      return b.experienceLevel - a.experienceLevel;
    return a.name.localeCompare(b.name);
  });
}

function StaffRosterComponent({
  h,
}: Readonly<ComponentProps<StaffRosterConfig>>) {
  const rosterRaw = useDataValue("data", "kc.crewRoster");
  const staff = parseStaff(rosterRaw);

  const rows = h ?? 8;
  const showSubtitle = rows >= 4;

  if (staff === null) {
    return (
      <Panel>
        <PanelTitle>STAFF ROSTER</PanelTitle>
        {showSubtitle && (
          <PanelSubtitle>Awaiting roster telemetry</PanelSubtitle>
        )}
      </Panel>
    );
  }

  if (staff.length === 0) {
    return (
      <Panel>
        <PanelTitle>STAFF ROSTER</PanelTitle>
        {showSubtitle && (
          <PanelSubtitle>Roster empty — no kerbals hired.</PanelSubtitle>
        )}
      </Panel>
    );
  }

  const sorted = sortStaff(staff);
  const available = staff.filter((s) => s.available).length;

  return (
    <Panel>
      <PanelTitle>STAFF ROSTER</PanelTitle>
      {showSubtitle && (
        <PanelSubtitle role="status" aria-live="polite">
          {available}/{staff.length} available
        </PanelSubtitle>
      )}
      <Body>
        <List>
          {sorted.map((kerbal) => (
            <Row
              key={kerbal.name}
              $available={kerbal.available}
              title={buildTooltip(kerbal)}
            >
              <Name>{kerbal.name}</Name>
              <Meta>
                <TraitTag>{kerbal.trait || "—"}</TraitTag>
                <Level>L{kerbal.experienceLevel}</Level>
                {kerbal.veteran && (
                  <Badge tone="go" size="sm" aria-label="veteran">
                    ★
                  </Badge>
                )}
                {kerbal.isBadass && (
                  <Badge tone="warn" size="sm" aria-label="badass">
                    BA
                  </Badge>
                )}
                {kerbal.careerFlights > 0 && (
                  <Badge
                    tone="neutral"
                    size="sm"
                    aria-label={`${kerbal.careerFlights} flights`}
                  >
                    {kerbal.careerFlights}F
                  </Badge>
                )}
                {!kerbal.available && (
                  <Badge tone="nogo" size="sm">
                    {kerbal.unavailableReason || "Unavailable"}
                  </Badge>
                )}
              </Meta>
            </Row>
          ))}
        </List>
      </Body>
    </Panel>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const Body = styled(ScrollArea)`
  flex: 1;
  min-height: 0;

  [data-scroll-area-inner] {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const Row = styled.li<{ $available: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 2px;
  background: var(--color-surface-panel);
  opacity: ${(p) => (p.$available ? 1 : 0.5)};
`;

const Name = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Meta = styled.span`
  display: inline-flex;
  gap: 4px;
  flex-shrink: 0;
  align-items: baseline;
`;

const TraitTag = styled.span`
  font-size: 9px;
  letter-spacing: 0.06em;
  color: var(--color-text-muted);
  text-transform: uppercase;
`;

const Level = styled.span`
  font-size: 10px;
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<StaffRosterConfig>({
  id: "staff-roster",
  name: "Staff Roster",
  description:
    "Whole-program kerbal roster sourced from kc.crewRoster — pilots, engineers, scientists, tourists. Sorted available-first then by trait + experience. Unavailable kerbals greyed with reason (Assigned / Hospitalised / etc.) in the tooltip. Cross-scene: works at SC, in flight, in editor.",
  tags: ["career", "crew"],
  defaultSize: { w: 5, h: 7 },
  minSize: { w: 3, h: 4 },
  component: StaffRosterComponent,
  dataRequirements: ["kc.crewRoster"],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { StaffRosterComponent };
