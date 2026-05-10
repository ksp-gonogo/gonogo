import { useDataValue } from "@gonogo/core";
import { useModal } from "@gonogo/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";

/**
 * Ephemeral top-of-viewport banner that fires when `recovery.hasRecent`
 * transitions false → true (a fresh mission summary just landed via the
 * fork's RecoveryDialogHandler). Surfaces the headline totals; tap to
 * open the full breakdown modal.
 *
 * Mirrors the `SceneChangeBanner` pattern. Stays visible for VISIBLE_MS
 * then auto-dismisses; tapping it pins the modal until closed. The
 * underlying snapshot persists in `recovery.lastSummary` for the rest
 * of the session, so a station that joined after the recovery still
 * sees the data when it opens the modal — they just miss the banner.
 *
 * Cross-station-friendly: every screen subscribes to `recovery.hasRecent`
 * via the existing data-source bridge, so each screen pops its own
 * independent banner on transition. No host coordination needed.
 */

const VISIBLE_MS = 10_000;

interface RecoverySummary {
  vesselName: string;
  recoveryLocation: string;
  recoveryFactor: string;
  scienceEarned: number;
  totalScience: number;
  fundsEarned: number;
  totalFunds: number;
  reputationEarned: number;
  totalReputation: number;
  displayReputation: boolean;
  scienceBreakdown: ScienceEntry[];
  partBreakdown: PartEntry[];
  resourceBreakdown: ResourceEntry[];
  crewBreakdown: CrewEntry[];
  capturedAtUT: number;
}

interface ScienceEntry {
  subjectId: string;
  subjectTitle: string;
  dataGathered: number;
  scienceAmount: number;
}
interface PartEntry {
  partName: string;
  partTitle: string;
  count: number;
  partValue: number;
  resourcesValue: number;
  totalValue: number;
}
interface ResourceEntry {
  resourceName: string;
  amount: number;
  unitValue: number;
  totalValue: number;
}
interface CrewEntry {
  name: string;
  trait: string;
  isTourist: boolean;
  xpGained: number;
  levelsGained: number;
  newLevel: number;
}

function parseSummary(raw: unknown): RecoverySummary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  return {
    vesselName: str(e.vesselName),
    recoveryLocation: str(e.recoveryLocation),
    recoveryFactor: str(e.recoveryFactor),
    scienceEarned: num(e.scienceEarned),
    totalScience: num(e.totalScience),
    fundsEarned: num(e.fundsEarned),
    totalFunds: num(e.totalFunds),
    reputationEarned: num(e.reputationEarned),
    totalReputation: num(e.totalReputation),
    displayReputation: e.displayReputation === true,
    scienceBreakdown: parseArray(e.scienceBreakdown, (x) => ({
      subjectId: str(x.subjectId),
      subjectTitle: str(x.subjectTitle),
      dataGathered: num(x.dataGathered),
      scienceAmount: num(x.scienceAmount),
    })),
    partBreakdown: parseArray(e.partBreakdown, (x) => ({
      partName: str(x.partName),
      partTitle: str(x.partTitle),
      count: num(x.count) || 1,
      partValue: num(x.partValue),
      resourcesValue: num(x.resourcesValue),
      totalValue: num(x.totalValue),
    })),
    resourceBreakdown: parseArray(e.resourceBreakdown, (x) => ({
      resourceName: str(x.resourceName),
      amount: num(x.amount),
      unitValue: num(x.unitValue),
      totalValue: num(x.totalValue),
    })),
    crewBreakdown: parseArray(e.crewBreakdown, (x) => ({
      name: str(x.name),
      trait: str(x.trait),
      isTourist: x.isTourist === true,
      xpGained: num(x.xpGained),
      levelsGained: num(x.levelsGained),
      newLevel: num(x.newLevel),
    })),
    capturedAtUT: num(e.capturedAtUT),
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}
function parseArray<T>(
  raw: unknown,
  map: (x: Record<string, unknown>) => T,
): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    out.push(map(entry as Record<string, unknown>));
  }
  return out;
}

export function RecoverySummaryBanner() {
  const hasRecentRaw = useDataValue("data", "recovery.hasRecent");
  const summaryRaw = useDataValue("data", "recovery.lastSummary");

  const hasRecent = hasRecentRaw === true;
  const summary = useMemo(() => parseSummary(summaryRaw), [summaryRaw]);

  // Track previous hasRecent value so we only fire on the false→true
  // transition (not on every snapshot update — recovery.lastSummary
  // changes are pushed live by the WS, but the banner only wants the
  // moment of capture).
  //
  // We key the announcement on `capturedAtUT` so re-renders that don't
  // bring a new snapshot don't re-show the banner.
  const prevHasRecentRef = useRef<boolean>(false);
  const lastAnnouncedUtRef = useRef<number | null>(null);
  const [bannerExpiresAt, setBannerExpiresAt] = useState<number | null>(null);
  const modal = useModal();

  useEffect(() => {
    const prev = prevHasRecentRef.current;
    prevHasRecentRef.current = hasRecent;
    if (!hasRecent) return;
    if (!summary) return;
    // Only fire when the captured-at UT changes, so repeated reads of
    // the same snapshot don't reopen the banner. Initial render with
    // a pre-existing snapshot also doesn't fire (prev was false but
    // we'd already-announced).
    if (lastAnnouncedUtRef.current === summary.capturedAtUT) return;
    // Only on transition (was false, now true) OR fresh ut.
    if (prev || lastAnnouncedUtRef.current !== null) {
      // Already saw a prior snapshot; this is a fresh capture only if
      // the ut changed (checked above).
    }
    lastAnnouncedUtRef.current = summary.capturedAtUT;
    setBannerExpiresAt(Date.now() + VISIBLE_MS);
  }, [hasRecent, summary]);

  useEffect(() => {
    if (bannerExpiresAt === null) return;
    const remaining = bannerExpiresAt - Date.now();
    if (remaining <= 0) {
      setBannerExpiresAt(null);
      return;
    }
    const id = setTimeout(() => setBannerExpiresAt(null), remaining);
    return () => clearTimeout(id);
  }, [bannerExpiresAt]);

  if (!summary) return null;

  if (bannerExpiresAt === null) return null;

  return (
    <Banner
      type="button"
      role="status"
      aria-live="polite"
      onClick={() => {
        setBannerExpiresAt(null);
        modal.open(<RecoveryDetail summary={summary} />, {
          title: `${summary.vesselName || "Vessel"} recovered`,
          width: "640px",
        });
      }}
    >
      <BannerLabel>VESSEL RECOVERED</BannerLabel>
      <BannerVessel>{summary.vesselName || "Untitled"}</BannerVessel>
      <BannerStats>
        <Stat>+{Math.round(summary.fundsEarned).toLocaleString()}f</Stat>
        <Stat>+{summary.scienceEarned.toFixed(1)} sci</Stat>
        {summary.displayReputation && (
          <Stat>+{summary.reputationEarned.toFixed(1)} rep</Stat>
        )}
      </BannerStats>
      <BannerHint>Tap for breakdown</BannerHint>
    </Banner>
  );
}

function RecoveryDetail({ summary }: { summary: RecoverySummary }) {
  return (
    <DetailWrap>
      <DetailHeader>
        <DetailTitle>{summary.vesselName || "Untitled Vessel"}</DetailTitle>
        <DetailMeta>
          {summary.recoveryLocation} · {summary.recoveryFactor}
        </DetailMeta>
      </DetailHeader>

      <Totals>
        <TotalRow>
          <TotalLabel>Funds</TotalLabel>
          <TotalValue>
            +{Math.round(summary.fundsEarned).toLocaleString()} · total{" "}
            {Math.round(summary.totalFunds).toLocaleString()}
          </TotalValue>
        </TotalRow>
        <TotalRow>
          <TotalLabel>Science</TotalLabel>
          <TotalValue>
            +{summary.scienceEarned.toFixed(1)} · total{" "}
            {summary.totalScience.toFixed(1)}
          </TotalValue>
        </TotalRow>
        {summary.displayReputation && (
          <TotalRow>
            <TotalLabel>Reputation</TotalLabel>
            <TotalValue>
              +{summary.reputationEarned.toFixed(1)} · total{" "}
              {summary.totalReputation.toFixed(1)}
            </TotalValue>
          </TotalRow>
        )}
      </Totals>

      {summary.scienceBreakdown.length > 0 && (
        <DetailSection>
          <SectionTitle>Science gathered</SectionTitle>
          {summary.scienceBreakdown.map((s) => (
            <DetailRow key={s.subjectId}>
              <DetailRowTitle>{s.subjectTitle || s.subjectId}</DetailRowTitle>
              <DetailRowValue>+{s.scienceAmount.toFixed(1)} sci</DetailRowValue>
            </DetailRow>
          ))}
        </DetailSection>
      )}

      {summary.crewBreakdown.length > 0 && (
        <DetailSection>
          <SectionTitle>Crew</SectionTitle>
          {summary.crewBreakdown.map((c) => (
            <DetailRow key={c.name}>
              <DetailRowTitle>
                {c.name}
                {c.isTourist ? " (tourist)" : ` · ${c.trait}`}
              </DetailRowTitle>
              <DetailRowValue>
                +{c.xpGained.toFixed(1)} XP
                {c.levelsGained > 0 && ` · L${c.newLevel}`}
              </DetailRowValue>
            </DetailRow>
          ))}
        </DetailSection>
      )}

      {summary.partBreakdown.length > 0 && (
        <DetailSection>
          <SectionTitle>Parts ({summary.partBreakdown.length})</SectionTitle>
          {summary.partBreakdown.map((p) => (
            <DetailRow key={p.partName}>
              <DetailRowTitle>
                {p.partTitle || p.partName}
                {p.count > 1 && ` ×${p.count}`}
              </DetailRowTitle>
              <DetailRowValue>
                {Math.round(p.totalValue).toLocaleString()}f
              </DetailRowValue>
            </DetailRow>
          ))}
        </DetailSection>
      )}

      {summary.resourceBreakdown.length > 0 && (
        <DetailSection>
          <SectionTitle>Resources</SectionTitle>
          {summary.resourceBreakdown.map((r) => (
            <DetailRow key={r.resourceName}>
              <DetailRowTitle>
                {r.resourceName} · {r.amount.toFixed(1)}u
              </DetailRowTitle>
              <DetailRowValue>
                {Math.round(r.totalValue).toLocaleString()}f
              </DetailRowValue>
            </DetailRow>
          ))}
        </DetailSection>
      )}
    </DetailWrap>
  );
}

// ── Banner styles ─────────────────────────────────────────────────────────

const Banner = styled.button`
  position: fixed;
  top: 48px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: var(--color-surface-overlay, rgba(20, 22, 26, 0.92));
  border: 1px solid var(--color-status-go-fg);
  border-radius: 3px;
  font-family: inherit;
  font-size: 12px;
  color: var(--color-text-primary);
  z-index: 100;
  cursor: pointer;
  animation: recoveryBannerIn 280ms ease-out forwards;

  &:hover {
    background: var(--color-surface-raised);
  }

  &:focus-visible {
    outline: 2px solid var(--color-status-go-fg);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: no-preference) {
    @keyframes recoveryBannerIn {
      from {
        opacity: 0;
        transform: translate(-50%, -8px);
      }
      to {
        opacity: 1;
        transform: translate(-50%, 0);
      }
    }
  }
`;

const BannerLabel = styled.span`
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--color-status-go-fg);
  font-weight: 700;
`;

const BannerVessel = styled.span`
  color: var(--color-text-primary);
  font-weight: 600;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const BannerStats = styled.span`
  display: inline-flex;
  gap: 8px;
`;

const Stat = styled.span`
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
`;

const BannerHint = styled.span`
  color: var(--color-text-faint);
  font-size: 10px;
  letter-spacing: 0.06em;
`;

// ── Modal detail styles ───────────────────────────────────────────────────

const DetailWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 480px;
  max-width: 640px;
  max-height: 70vh;
  overflow-y: auto;
`;

const DetailHeader = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const DetailTitle = styled.h2`
  margin: 0;
  font-size: var(--font-size-lg);
  color: var(--color-text-primary);
`;

const DetailMeta = styled.span`
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
`;

const Totals = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px;
  background: var(--color-surface-raised);
  border-radius: 3px;
`;

const TotalRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
`;

const TotalLabel = styled.span`
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
`;

const TotalValue = styled.span`
  font-size: var(--font-size-base);
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
`;

const DetailSection = styled.section`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const SectionTitle = styled.h3`
  margin: 0;
  font-size: var(--font-size-sm);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  padding-bottom: 4px;
  border-bottom: 1px solid var(--color-border-subtle);
`;

const DetailRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  padding: 4px 0;
  font-size: var(--font-size-sm);
`;

const DetailRowTitle = styled.span`
  color: var(--color-text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const DetailRowValue = styled.span`
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
`;
