import type { ComponentProps } from "@gonogo/core";
import { registerComponent, useDataValue } from "@gonogo/core";
import { Panel, PanelSubtitle, PanelTitle, ScrollArea } from "@gonogo/ui";
import styled from "styled-components";

type SpaceCenterStatusConfig = Record<string, never>;

const FACILITIES: Array<{ key: FacilityKey; label: string }> = [
  { key: "launchPad", label: "Launch Pad" },
  { key: "runway", label: "Runway" },
  { key: "vab", label: "VAB" },
  { key: "sph", label: "SPH" },
  { key: "mission", label: "Mission Control" },
  { key: "tracking", label: "Tracking" },
  { key: "admin", label: "Admin" },
  { key: "rd", label: "R&D" },
  { key: "astronaut", label: "Astronaut" },
];

type FacilityKey =
  | "launchPad"
  | "runway"
  | "vab"
  | "sph"
  | "mission"
  | "tracking"
  | "admin"
  | "rd"
  | "astronaut";

interface FacilityLevel {
  level: number;
  max: number;
}

export type FacilityLevels = Partial<Record<FacilityKey, FacilityLevel>>;

/**
 * Defensive parser for the `kc.facilityLevels` payload from the
 * GonogoTelemetry KSP plugin. Accepts the documented dict shape and
 * drops anything that doesn't read as `{ level: number, max: number }`
 * — sandbox saves emit zeroed entries, which is fine.
 */
export function parseFacilityLevels(raw: unknown): FacilityLevels {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: FacilityLevels = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const entry = v as Record<string, unknown>;
    const level = typeof entry.level === "number" ? entry.level : null;
    const max = typeof entry.max === "number" ? entry.max : null;
    if (level === null || max === null) continue;
    if (!FACILITIES.some((f) => f.key === k)) continue;
    out[k as FacilityKey] = { level, max };
  }
  return out;
}

function SpaceCenterStatusComponent({
  w,
  h,
}: Readonly<ComponentProps<SpaceCenterStatusConfig>>) {
  const facilitiesRaw = useDataValue("data", "kc.facilityLevels");
  const partsAvailable = useDataValue("data", "kc.partsAvailable");
  const launchSite = useDataValue("data", "kc.launchSite") as
    | string
    | undefined;
  const padOccupied = useDataValue("data", "kc.padOccupied") as
    | boolean
    | undefined;
  const padVesselTitle = useDataValue("data", "kc.padVesselTitle") as
    | string
    | undefined;

  const facilities = parseFacilityLevels(facilitiesRaw);

  const cols = w ?? 6;
  const rows = h ?? 8;
  const showSubtitle = rows >= 4;
  const compactGrid = cols < 5;

  const padLine = padOccupied
    ? padVesselTitle
      ? `On pad: ${padVesselTitle}`
      : "Vehicle on pad"
    : launchSite
      ? `Last site: ${launchSite}`
      : "No vehicle on pad";

  return (
    <Panel>
      <PanelTitle>SPACE CENTER</PanelTitle>
      {showSubtitle && (
        <PanelSubtitle role="status" aria-live="polite">
          {padLine}
        </PanelSubtitle>
      )}

      <Body>
        <FacilityGrid $compact={compactGrid}>
          {FACILITIES.map(({ key, label }) => {
            const f = facilities[key];
            return (
              <FacilityCell key={key}>
                <FacilityLabel>{label}</FacilityLabel>
                <FacilityValue>
                  {f && f.max > 0 ? (
                    <>
                      <Tier>{f.level}</Tier>
                      <Slash>/</Slash>
                      <TierMax>{f.max - 1}</TierMax>
                    </>
                  ) : (
                    <Muted>—</Muted>
                  )}
                </FacilityValue>
              </FacilityCell>
            );
          })}
        </FacilityGrid>

        <Footer>
          <FooterCell>
            <FooterLabel>Parts</FooterLabel>
            <FooterValue>
              {typeof partsAvailable === "number" ? partsAvailable : "—"}
            </FooterValue>
          </FooterCell>
        </Footer>
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
    gap: 10px;
  }
`;

const FacilityGrid = styled.div<{ $compact: boolean }>`
  display: grid;
  grid-template-columns: ${(p) =>
    p.$compact ? "repeat(2, 1fr)" : "repeat(3, 1fr)"};
  gap: 6px;
`;

const FacilityCell = styled.div`
  display: flex;
  flex-direction: column;
  padding: 6px 8px;
  background: var(--color-surface-panel);
  border-radius: 2px;
`;

const FacilityLabel = styled.span`
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
`;

const FacilityValue = styled.span`
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
`;

const Tier = styled.span`
  color: var(--color-accent-fg);
`;

const Slash = styled.span`
  color: var(--color-text-faint);
  margin: 0 2px;
`;

const TierMax = styled.span`
  color: var(--color-text-muted);
`;

const Muted = styled.span`
  color: var(--color-text-faint);
`;

const Footer = styled.div`
  display: flex;
  gap: 16px;
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--color-surface-raised);
`;

const FooterCell = styled.div`
  display: flex;
  flex-direction: column;
`;

const FooterLabel = styled.span`
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--color-text-faint);
`;

const FooterValue = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<SpaceCenterStatusConfig>({
  id: "space-center-status",
  name: "Space Center Status",
  description:
    "KSC overview — facility levels (VAB, SPH, R&D, …), parts unlocked under current tech, and launch-pad state. Read-only Phase 1 of the career-mode mission-control extensions.",
  tags: ["career", "kc"],
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 3, h: 4 },
  component: SpaceCenterStatusComponent,
  dataRequirements: [
    "kc.facilityLevels",
    "kc.partsAvailable",
    "kc.launchSite",
    "kc.padOccupied",
    "kc.padVesselTitle",
  ],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { SpaceCenterStatusComponent };
