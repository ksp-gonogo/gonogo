import type { ComponentProps } from "@gonogo/core";
import {
  formatCompactCurrency,
  getSizeBucket,
  registerComponent,
  useDataStreamStatus,
  useDataValue,
  useExecuteAction,
} from "@gonogo/core";
import {
  Panel,
  PanelSubtitle,
  PanelTitle,
  ScrollArea,
  StreamStatusBadge,
} from "@gonogo/ui";
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

/**
 * M3b career-detail batch: `career.status.facilities` (mod/Sitrep.Host/
 * CareerViewProvider.cs's `BuildFacilities`) is keyed by the full
 * `SpaceCenterFacility` enum name, not this widget's short codes — maps
 * each enum name onto its `FacilityKey`. Names match the real wire
 * (decompile-confirmed, career-capture-extend-report.md; also the exact 9
 * keys observed in a real `career.status` capture).
 */
const ENUM_FACILITY_TO_KEY: Readonly<Record<string, FacilityKey>> = {
  LaunchPad: "launchPad",
  Runway: "runway",
  VehicleAssemblyBuilding: "vab",
  SpaceplaneHangar: "sph",
  MissionControl: "mission",
  TrackingStation: "tracking",
  Administration: "admin",
  ResearchAndDevelopment: "rd",
  AstronautComplex: "astronaut",
};

interface FacilityLevel {
  level: number;
  max: number;
  /** Funds cost for the next-tier upgrade. 0 = unknown / already at max. */
  upgradeFunds: number;
  /**
   * Multi-line text matching what KSP's stock upgrade dialog shows for
   * the current tier (e.g. "* Max Active Strategies: 1\n* Max Commitment: 25.0%").
   * Empty string when the fork isn't emitting them yet — older DLLs
   * before the 2026-05-13 update.
   */
  currentLevelText: string;
  /** Same shape as `currentLevelText`, but for what the *next* upgrade
   *  would unlock. Empty string when at max tier (no next) or when the
   *  fork doesn't emit them. */
  nextLevelText: string;
}

export type FacilityLevels = Partial<Record<FacilityKey, FacilityLevel>>;

/**
 * Defensive parser for facility-level payloads. Accepts BOTH the legacy
 * `kc.facilityLevels` shape (keyed by short code — launchPad/vab/sph/… —
 * `{ level, max, upgradeFunds, currentLevelText, nextLevelText }`) and the
 * M3b career-detail wire shape (`career.status.facilities`, keyed by the
 * full `SpaceCenterFacility` enum name — `{ currentTier, maxTier,
 * upgradeCost }`, career-capture-extend-report.md). The new wire's
 * `currentTier`/`maxTier` are the SAME 0-based tier-index convention this
 * widget already assumes for `level`/`max` (decompile-confirmed: a fully
 * upgraded facility reports `currentTier === maxTier`, both actual-tier-
 * minus-one — see the "Lvl N of M" comment in the render below), so they
 * map straight across with no reinterpretation. `upgradeCost` maps to
 * `upgradeFunds` 1:1; `null` (at max, or scene-gated) becomes `0`, the
 * existing "unknown or at max" sentinel. `currentLevelText`/`nextLevelText`
 * have no new-wire equivalent — always `""` for an enum-keyed entry,
 * degrading exactly like an older legacy DLL that never emitted them.
 * Drops anything that doesn't read as one of the two known shapes —
 * sandbox saves emit zeroed entries, which is fine.
 */
export function parseFacilityLevels(raw: unknown): FacilityLevels {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: FacilityLevels = {};
  for (const [rawKey, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const entry = v as Record<string, unknown>;

    const key: FacilityKey | undefined = FACILITIES.some(
      (f) => f.key === rawKey,
    )
      ? (rawKey as FacilityKey)
      : ENUM_FACILITY_TO_KEY[rawKey];
    if (key === undefined) continue;

    if (typeof entry.level === "number" && typeof entry.max === "number") {
      out[key] = {
        level: entry.level,
        max: entry.max,
        upgradeFunds:
          typeof entry.upgradeFunds === "number" ? entry.upgradeFunds : 0,
        currentLevelText:
          typeof entry.currentLevelText === "string"
            ? entry.currentLevelText
            : "",
        nextLevelText:
          typeof entry.nextLevelText === "string" ? entry.nextLevelText : "",
      };
      continue;
    }

    if (
      typeof entry.currentTier === "number" &&
      typeof entry.maxTier === "number"
    ) {
      out[key] = {
        level: entry.currentTier,
        max: entry.maxTier,
        upgradeFunds:
          typeof entry.upgradeCost === "number" ? entry.upgradeCost : 0,
        currentLevelText: "",
        nextLevelText: "",
      };
    }
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
  // M3 career batch: career.funds -> career.status.economy.funds.
  // M3b career-detail batch: kc.facilityLevels -> career.status.facilities
  // now MAPPED too — parseFacilityLevels accepts the enum-keyed
  // currentTier/maxTier/upgradeCost shape (career-capture-extend-report.md)
  // alongside the legacy short-code shape, so both the funds readout AND
  // the facility tier/upgrade-cost grid stream live off career.status.
  // partsAvailable/launchSite/padOccupied/padVesselTitle/scene are still
  // gapped kc.* GonogoTelemetry keys with no career.status equivalent and
  // stay legacy. kc.upgradeFacility[...] (the spend command) still has no
  // command home either (KNOWN_COMMAND_GAPS) and falls back to legacy
  // automatically — this batch migrates reads only.
  const streamStatus = useDataStreamStatus("data", "career.funds");
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
  // 3-col grid only when the widget is wide enough for each cell to hold a
  // facility name + tier + the multi-line tier text without clipping. At
  // width 5 (e.g. the tall-narrow portrait aspect) three columns squeeze
  // each cell to ~115px and the full-text bodies overflow horizontally
  // ("* Max Size: Unlimit…", "Maneuve nodes"). Reflow those to 2 columns
  // and drop the verbose tier text — the same affordance `compact` already
  // gives the (tiny-bucketed) narrow grid. cols>=6 keeps the reviewed
  // default-6x7 / wide / mobile layouts unchanged.
  const compactGrid = cols < 6;
  const sizeBucket = getSizeBucket(w, h);

  const padLine = padOccupied
    ? padVesselTitle
      ? `On pad: ${padVesselTitle}`
      : "Vehicle on pad"
    : launchSite
      ? `Last site: ${launchSite}`
      : "No vehicle on pad";

  if (sizeBucket === "tiny") {
    return (
      <Panel>
        <PanelTitle>KSC</PanelTitle>
        <TinyBody>
          {typeof careerFunds === "number" ? (
            <TinyFunds title={`${Math.round(careerFunds).toLocaleString()}f`}>
              {formatTinyFunds(Math.round(careerFunds))}
              <TinyFundsUnit>f</TinyFundsUnit>
            </TinyFunds>
          ) : (
            <TinyFunds>—</TinyFunds>
          )}
          <TinyPad
            $occupied={padOccupied === true}
            title={padLine}
            role="img"
            aria-label={padLine}
          >
            {padOccupied === true ? "PAD ACTIVE" : "PAD CLEAR"}
          </TinyPad>
        </TinyBody>
      </Panel>
    );
  }

  return (
    <Panel>
      <TitleRow>
        <PanelTitle>SPACE CENTER</PanelTitle>
        <StreamStatusBadge status={streamStatus} />
      </TitleRow>
      {showSubtitle && (
        <PanelSubtitle role="status" aria-live="polite">
          {padLine}
          {typeof careerFunds === "number" && (
            <FundsReadout title="Available funds">
              · {Math.round(careerFunds).toLocaleString()}f
            </FundsReadout>
          )}
        </PanelSubtitle>
      )}

      <Body>
        <FacilityGrid $compact={compactGrid}>
          {FACILITIES.map(({ key, label }) => {
            const f = facilities[key];
            // Live curl 2026-05-13 confirmed: the fork's `max` field is the
            // upgrade-count (KSP's `GetFacilityLevelCount`), not the
            // tier-count. VAB returns `{level:2, max:2}` at full tier 3,
            // launchPad returns `{level:1, max:2}` at tier 2. So the total
            // number of tiers is `max + 1` and the operator-facing "Lvl N
            // of M" should read `{level+1}/{max+1}` — matches KSP's stock
            // R&D dialog which calls VAB tier 3 "Level 3".
            const atMax = !!f && f.max > 0 && f.level >= f.max;
            const displayLevel = f ? f.level + 1 : 0;
            const displayMax = f && f.max > 0 ? f.max + 1 : 0;
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
            // Build a hover-tooltip body summarising the current tier's
            // bullet-list and (if available) the next-tier preview. The
            // newlines from the fork stay as \n — the browser's `title`
            // attribute renders them with native multi-line wrapping in
            // the OS-level tooltip on every major platform.
            const tooltip = buildFacilityTooltip(label, f);
            const showFullTextBody =
              !compactGrid &&
              !!f &&
              (f.currentLevelText !== "" || f.nextLevelText !== "");
            return (
              <FacilityCell key={key} title={tooltip || undefined}>
                <FacilityLabel>{label}</FacilityLabel>
                <FacilityValue
                  // role="img" + aria-label so AT announces a coherent
                  // "Launch Pad tier 2 of 3" instead of the "2 / 3" spans
                  // read as fragments (and makes aria-label valid on the
                  // otherwise-roleless value container).
                  role="img"
                  aria-label={
                    f && f.max > 0
                      ? `${label} tier ${displayLevel} of ${displayMax}`
                      : `${label} tier unknown`
                  }
                >
                  {f && f.max > 0 ? (
                    <>
                      <Tier>{displayLevel}</Tier>
                      <Slash>/</Slash>
                      <TierMax>{displayMax}</TierMax>
                    </>
                  ) : (
                    <Muted>—</Muted>
                  )}
                </FacilityValue>
                {f && f.upgradeFunds > 0 && !atMax && (
                  <UpgradeRow>
                    <UpgradeCost $afford={canAfford}>
                      {formatCompactCurrency(f.upgradeFunds)}
                    </UpgradeCost>
                    <UpgradeButton
                      facilityKey={key}
                      enabled={canUpgrade}
                      execute={execute}
                      titleOverride={
                        f.nextLevelText
                          ? `Upgrade to tier ${displayLevel + 1}:\n${f.nextLevelText}`
                          : undefined
                      }
                    />
                  </UpgradeRow>
                )}
                {atMax && <MaxBadge>MAX</MaxBadge>}
                {showFullTextBody && f && (
                  <FullText>
                    {f.currentLevelText && (
                      <FullTextBlock>
                        <FullTextLabel>Now</FullTextLabel>
                        <FullTextBody>{f.currentLevelText}</FullTextBody>
                      </FullTextBlock>
                    )}
                    {f.nextLevelText && (
                      <FullTextBlock>
                        <FullTextLabel>Next</FullTextLabel>
                        <FullTextBody>{f.nextLevelText}</FullTextBody>
                      </FullTextBlock>
                    )}
                  </FullText>
                )}
              </FacilityCell>
            );
          })}
        </FacilityGrid>

        <Footer>
          <FooterCell title="Parts unlocked by current R&D tier">
            <FooterLabel>Parts unlocked</FooterLabel>
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
  titleOverride,
}: {
  facilityKey: FacilityKey;
  enabled: boolean;
  execute: (action: string) => Promise<void>;
  titleOverride?: string;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), ARM_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [armed]);

  if (!enabled) {
    return (
      <UpgradeButtonStyled type="button" disabled title={titleOverride}>
        Upgrade
      </UpgradeButtonStyled>
    );
  }
  if (!armed) {
    return (
      <UpgradeButtonStyled
        type="button"
        onClick={() => setArmed(true)}
        title={titleOverride}
      >
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
      title={titleOverride}
    >
      Confirm
    </ConfirmUpgradeButton>
  );
}

// Multi-line tooltip body shown on cell hover. Combines current-tier
// text with next-tier preview (when not at max) so the operator can
// compare without opening anything. The browser renders \n natively
// in title attributes on every major platform.
function buildFacilityTooltip(label: string, f?: FacilityLevel): string {
  if (!f) return label;
  if (!f.currentLevelText && !f.nextLevelText) {
    return `${label} (older Telemachus DLL — no level descriptions)`;
  }
  const parts: string[] = [`${label} — tier ${f.level + 1} of ${f.max + 1}`];
  if (f.currentLevelText) {
    parts.push("", "NOW", f.currentLevelText);
  }
  if (f.nextLevelText) {
    parts.push("", "NEXT", f.nextLevelText);
  }
  return parts.join("\n");
}

// Compact funds for the tiny (2x3) bucket where the box is only ~2 grid
// columns wide. Drops to whole-number k/M so the string stays 3-4 chars
// ("290k", "78k", "13k") — the decimal form ("289.8k") overflows the
// narrowest box. The full value lives in the cell's `title` attribute.
function formatTinyFunds(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${Math.round(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${Math.round(value / 1_000)}k`;
  return value.toFixed(0);
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
    p.$compact ? "repeat(2, minmax(0, 1fr))" : "repeat(3, minmax(0, 1fr))"};
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
  line-height: 1.3;
  /* Reserve room for a two-line wrap (e.g. "Launch Pad" / "Mission
     Control" at the narrow default-6x7 3-col grid) on every cell, not
     just the ones that need it. Without this, a facility with a
     short one-line label (Runway, VAB) sits higher in its cell than
     its row-mate with a two-line label (Launch Pad) — everything
     below (tier value, cost, Upgrade button) inherits the offset, so
     the Upgrade buttons across a row land at visibly different
     heights even though each button box itself is the same size. */
  display: block;
  min-height: 2.6em;
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
  /* Allow the Upgrade button to wrap to a new line when the grid cell
     is too narrow for cost + button side-by-side (default-6x7 at
     3-col grid gives ~62 px per cell, not enough for both). The
     button keeps its full label and stacks below the cost label. */
  flex-wrap: wrap;
`;

const UpgradeCost = styled.span<{ $afford: boolean }>`
  font-size: 10px;
  /* Unaffordable cost must read as a nogo signal on the dark panel cell.
     The nogo *-fg token is the foreground meant to sit on the red *-bg
     fill — as standalone text on the near-black cell it's a pale pink that
     reads like ordinary light copy and the warning is lost. Use the
     saturated nogo *-bg token as the text colour instead — the established
     "nogo text on a dark surface" treatment (PerfBudgets, Twr, ShipMap)
     with adequate contrast. */
  color: ${(p) =>
    p.$afford ? "var(--color-accent-fg)" : "var(--color-status-nogo-bg)"};
  font-weight: ${(p) => (p.$afford ? "inherit" : "600")};
  font-variant-numeric: tabular-nums;
`;

const MaxBadge = styled.span`
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--color-text-faint);
  text-transform: uppercase;
  margin-top: 2px;
`;

const FullText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--color-surface-raised);
`;

const FullTextBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const FullTextLabel = styled.span`
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-faint);
`;

const FullTextBody = styled.pre`
  margin: 0;
  font-family: inherit;
  font-size: 10px;
  line-height: 1.35;
  color: var(--color-text-muted);
  white-space: pre-wrap;
`;

const UpgradeButtonStyled = styled.button`
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 2px 6px;
  border-radius: 2px;
  border: 1px solid var(--color-surface-raised);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font-family: inherit;
  box-sizing: border-box;
  text-align: center;
  /* At the narrow default-6x7 3-col grid the facility cell interior is
     only ~46px — narrower than "Upgrade" can render on one line. A
     fixed nowrap width used to solve an old label-clipping bug by
     refusing to shrink, but that just moved the problem: the button
     kept its full intrinsic width and overflowed the cell (and, for
     the last column, right past the panel's own padding, reading as
     a "cut off" button). Let it shrink and wrap instead — every
     character stays visible, just spread over two lines, and the box
     never exceeds the space its row actually has. */
  min-width: 0;
  overflow-wrap: anywhere;

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
  /* The animation property must live inside the same media guard as
     the keyframes — the bare property outside the guard fires for
     reduced-motion users (CLAUDE.md a11y rule). */
  @media (prefers-reduced-motion: no-preference) {
    animation: upgradePulse 1s ease-in-out infinite;
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

const FundsReadout = styled.span`
  color: var(--color-status-go-fg);
  font-variant-numeric: tabular-nums;
  margin-left: 2px;
`;

const TinyBody = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px;
  overflow: hidden;
  container-type: inline-size;
`;

const TinyFunds = styled.div`
  /* Fluid size: large in a roomy "tiny" box (e.g. compact-4x7) but small
     enough that the abbreviated value (formatCompactCurrency → "290k") still fits the
     widget's 2x3 minSize floor (~110px wide) without clipping. */
  font-size: clamp(12px, 13cqw, 22px);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--color-status-go-fg);
  line-height: 1;
  max-width: 100%;
  white-space: nowrap;
`;

const TinyFundsUnit = styled.span`
  font-size: 12px;
  color: var(--color-text-muted);
  margin-left: 2px;
`;

const TinyPad = styled.span<{ $occupied: boolean }>`
  font-size: 9px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${(p) =>
    p.$occupied ? "var(--color-accent-fg)" : "var(--color-text-faint)"};
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<SpaceCenterStatusConfig>({
  id: "space-center-status",
  name: "Space Center Status",
  description:
    "KSC overview — facility levels (VAB, SPH, R&D, …), parts unlocked under current tech, launch-pad state, and arm-then-confirm upgrade buttons per facility (only enabled in the Space Center scene; disabled when funds are short or the facility is at max).",
  tags: ["career", "kc"],
  defaultSize: { w: 6, h: 7 },
  minSize: { w: 2, h: 2 },
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
