import type { ComponentProps } from "@gonogo/core";
import {
  registerComponent,
  useDataValue,
  useExecuteAction,
} from "@gonogo/core";
import { Panel, PanelSubtitle, PanelTitle, ScrollArea } from "@gonogo/ui";
import { useEffect, useState } from "react";
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
  /** Funds cost for the next-tier upgrade. 0 = unknown / already at max. */
  upgradeFunds: number;
}

export type FacilityLevels = Partial<Record<FacilityKey, FacilityLevel>>;

/**
 * Defensive parser for the `kc.facilityLevels` payload from the
 * GonogoTelemetry KSP plugin. Accepts the documented dict shape and
 * drops anything that doesn't read as `{ level: number, max: number,
 * upgradeFunds: number }` — sandbox saves emit zeroed entries, which
 * is fine. `upgradeFunds` is best-effort; missing → 0 means "unknown
 * or at max".
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
    const upgradeFunds =
      typeof entry.upgradeFunds === "number" ? entry.upgradeFunds : 0;
    out[k as FacilityKey] = { level, max, upgradeFunds };
  }
  return out;
}

const ARM_TIMEOUT_MS = 4000;

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
  const scene = useDataValue("data", "kc.scene") as string | undefined;
  const careerFunds = useDataValue("data", "career.funds") as
    | number
    | undefined;
  const execute = useExecuteAction("data");

  const facilities = parseFacilityLevels(facilitiesRaw);

  // Upgrades work in the Space Center scene only — KSP's upgrade
  // pipeline isn't safe to drive from elsewhere. Show the buttons
  // anyway when scene is unknown (telemetry warmup) so the operator
  // sees the affordance immediately when they walk back to SC.
  const upgradesEnabled = scene === undefined || scene === "SpaceCenter";

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
            const atMax = !!f && f.max > 0 && f.level >= f.max - 1;
            const canAfford =
              !!f &&
              f.upgradeFunds > 0 &&
              (typeof careerFunds !== "number" ||
                careerFunds >= f.upgradeFunds);
            const canUpgrade =
              upgradesEnabled &&
              !!f &&
              !atMax &&
              f.upgradeFunds > 0 &&
              canAfford;
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
                {f && f.upgradeFunds > 0 && !atMax && (
                  <UpgradeRow>
                    <UpgradeCost $afford={canAfford}>
                      {formatCost(f.upgradeFunds)}
                    </UpgradeCost>
                    <UpgradeButton
                      facilityKey={key}
                      enabled={canUpgrade}
                      execute={execute}
                    />
                  </UpgradeRow>
                )}
                {atMax && <MaxBadge>MAX</MaxBadge>}
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

function UpgradeButton({
  facilityKey,
  enabled,
  execute,
}: {
  facilityKey: FacilityKey;
  enabled: boolean;
  execute: (action: string) => Promise<void>;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), ARM_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [armed]);

  if (!enabled) {
    return (
      <UpgradeButtonStyled type="button" disabled>
        Upgrade
      </UpgradeButtonStyled>
    );
  }
  if (!armed) {
    return (
      <UpgradeButtonStyled type="button" onClick={() => setArmed(true)}>
        Upgrade
      </UpgradeButtonStyled>
    );
  }
  return (
    <ConfirmUpgradeButton
      type="button"
      onClick={() => {
        setArmed(false);
        void execute(`kc.upgradeFacility[${facilityKey}]`);
      }}
    >
      Confirm
    </ConfirmUpgradeButton>
  );
}

function formatCost(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(0);
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

const UpgradeRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-top: 4px;
`;

const UpgradeCost = styled.span<{ $afford: boolean }>`
  font-size: 10px;
  color: ${(p) =>
    p.$afford ? "var(--color-accent-fg)" : "var(--color-status-nogo-fg)"};
  font-variant-numeric: tabular-nums;
`;

const MaxBadge = styled.span`
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--color-text-faint);
  text-transform: uppercase;
  margin-top: 2px;
`;

const UpgradeButtonStyled = styled.button`
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 2px 8px;
  border-radius: 2px;
  border: 1px solid var(--color-surface-raised);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font-family: inherit;

  &:hover:not(:disabled) {
    color: var(--color-accent-fg);
    border-color: var(--color-accent-fg);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const ConfirmUpgradeButton = styled(UpgradeButtonStyled)`
  background: var(--color-status-go-bg);
  color: var(--color-status-go-fg);
  border-color: transparent;
  animation: upgradePulse 1s ease-in-out infinite;

  @media (prefers-reduced-motion: no-preference) {
    @keyframes upgradePulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.6;
      }
    }
  }
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
    "KSC overview — facility levels (VAB, SPH, R&D, …), parts unlocked under current tech, launch-pad state, and arm-then-confirm upgrade buttons per facility (only enabled in the Space Center scene; disabled when funds are short or the facility is at max).",
  tags: ["career", "kc"],
  defaultSize: { w: 6, h: 7 },
  minSize: { w: 3, h: 4 },
  component: SpaceCenterStatusComponent,
  dataRequirements: [
    "kc.facilityLevels",
    "kc.partsAvailable",
    "kc.launchSite",
    "kc.padOccupied",
    "kc.padVesselTitle",
    "kc.scene",
    "career.funds",
  ],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { SpaceCenterStatusComponent };
