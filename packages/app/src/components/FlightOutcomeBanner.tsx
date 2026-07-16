import { useTelemetry } from "@ksp-gonogo/core";
import { useFlight } from "@ksp-gonogo/data";
import { useStream } from "@ksp-gonogo/sitrep-client";
import { useModal } from "@ksp-gonogo/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";

/**
 * Ephemeral top-of-viewport banner that fires when a fresh flight-end
 * snapshot lands — either a recovery (`recovery.lastSummary`) or a
 * crash (`crash.lastCrash`). Both outcome kinds flow through this
 * single component so flight endings share the same UI slot.
 *
 * Auto-dismisses after VISIBLE_MS; tap to pin the detail modal.
 * On a new-flight transition, the announce baseline is reset to the
 * current sticky outcome's UT, so the previous flight's recovery
 * never re-triggers the banner — only an outcome captured after the
 * new flight started will fire.
 */

const VISIBLE_MS = 10_000;

// ── Recovery summary ─────────────────────────────────────────────────────

interface RecoverySummary {
  kind: "recovered";
  ut: number;
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

function parseRecovery(raw: unknown): RecoverySummary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  return {
    kind: "recovered",
    ut: num(e.capturedAtUT),
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
  };
}

// ── Crash summary ────────────────────────────────────────────────────────

interface CrashSummary {
  kind: "crashed";
  ut: number;
  vesselName: string;
  body: string;
  situation: string;
  what: string;
  partsLostCount: number;
  crewAboard: string[];
  kerbalsKilled: string[];
  flightEndMode: string;
  highestAltitude: number;
  highestSpeed: number;
  highestGee: number;
  groundDistance: number;
}

// crash.lastCrash only ever carries notable-vessel crashes — the Telemachus
// fork filters debris / flags / non-vessels at the source, so the banner
// trusts whatever it receives and never second-guesses by name or type.
function parseCrash(raw: unknown): CrashSummary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  const stats =
    e.flightStats &&
    typeof e.flightStats === "object" &&
    !Array.isArray(e.flightStats)
      ? (e.flightStats as Record<string, unknown>)
      : {};
  return {
    kind: "crashed",
    ut: num(e.ut),
    vesselName: str(e.vesselName),
    body: str(e.body),
    situation: str(e.situation),
    what: str(e.what),
    partsLostCount: Array.isArray(e.partsLost) ? e.partsLost.length : 0,
    crewAboard: parseStringArray(e.crewAboard),
    kerbalsKilled: parseStringArray(e.kerbalsKilled),
    flightEndMode: str(e.flightEndMode),
    highestAltitude: num(stats.highestAltitude),
    highestSpeed: num(stats.highestSpeed),
    highestGee: num(stats.highestGee),
    groundDistance: num(stats.groundDistance),
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

type Outcome = RecoverySummary | CrashSummary;

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
function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

// ── Component ────────────────────────────────────────────────────────────

export function FlightOutcomeBanner() {
  const recoveryHasRecent = useStream<boolean>("recovery.hasRecent") === true;
  const recoveryRaw = useTelemetry("recovery.lastSummary");
  const crashHasRecent = useStream<boolean>("crash.hasRecent") === true;
  const crashRaw = useTelemetry("crash.lastCrash");
  const currentFlight = useFlight();

  const recovery = useMemo(
    () => (recoveryHasRecent ? parseRecovery(recoveryRaw) : null),
    [recoveryHasRecent, recoveryRaw],
  );
  const crash = useMemo(
    () => (crashHasRecent ? parseCrash(crashRaw) : null),
    [crashHasRecent, crashRaw],
  );

  // Pick the most recent outcome. Recovery and crash are both reported in
  // KSP universal time, so a direct numeric compare works.
  const outcome: Outcome | null = useMemo(() => {
    if (recovery && crash) return crash.ut > recovery.ut ? crash : recovery;
    return recovery ?? crash ?? null;
  }, [recovery, crash]);

  // Banner state. lastAnnouncedRef is the (kind, ut) we last fired the
  // banner for; on a new-flight transition we baseline it to the current
  // sticky outcome so the previous flight's outcome doesn't re-fire.
  const lastAnnouncedRef = useRef<{ kind: string; ut: number } | null>(null);
  const flightIdRef = useRef<string | null>(null);
  const [bannerExpiresAt, setBannerExpiresAt] = useState<number | null>(null);
  const modal = useModal();

  useEffect(() => {
    const nextFlightId = currentFlight?.id ?? null;
    const prevFlightId = flightIdRef.current;
    if (prevFlightId === nextFlightId) return;
    flightIdRef.current = nextFlightId;
    // Baseline the announce key only on a true flight switch (one non-null
    // flight to another non-null flight). Transitions involving null —
    // mount-time bootstrap, or a flight ending into "no flight" — must not
    // baseline, because Effect 2 hasn't had a chance to fire the banner
    // for the just-arrived outcome yet. Effect order is declaration order;
    // this effect runs before Effect 2, so if we wrote
    // `lastAnnouncedRef.current = outcome` here, Effect 2 would see
    // `last === outcome` and silently swallow the banner.
    //
    // Live-curl 2026-05-13: confirmed the fork emits crash.lastCrash + has
    // crash.hasRecent=true. The earlier "crash didn't show on dashboard"
    // user report was this effect closing the banner mid-fire when the
    // flight ended (currentFlight: A → null) and the crash arrived in the
    // same render cycle.
    if (prevFlightId !== null && nextFlightId !== null) {
      lastAnnouncedRef.current = outcome
        ? { kind: outcome.kind, ut: outcome.ut }
        : null;
      setBannerExpiresAt(null);
    }
  }, [currentFlight, outcome]);

  useEffect(() => {
    if (!outcome) return;
    const last = lastAnnouncedRef.current;
    if (last && last.kind === outcome.kind && last.ut === outcome.ut) return;
    lastAnnouncedRef.current = { kind: outcome.kind, ut: outcome.ut };
    setBannerExpiresAt(Date.now() + VISIBLE_MS);
  }, [outcome]);

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

  if (!outcome || bannerExpiresAt === null) return null;

  if (outcome.kind === "recovered") {
    return (
      <RecoveryBanner
        type="button"
        role="status"
        aria-live="polite"
        onClick={() => {
          setBannerExpiresAt(null);
          modal.open(<RecoveryDetail summary={outcome} />, {
            title: `${outcome.vesselName || "Vessel"} recovered`,
            width: "640px",
          });
        }}
      >
        <BannerLabel $variant="recovered">VESSEL RECOVERED</BannerLabel>
        <BannerVessel>{outcome.vesselName || "Untitled"}</BannerVessel>
        <BannerStats>
          <Stat>+{Math.round(outcome.fundsEarned).toLocaleString()}f</Stat>
          <Stat>+{outcome.scienceEarned.toFixed(1)} sci</Stat>
          {outcome.displayReputation && (
            <Stat>+{outcome.reputationEarned.toFixed(1)} rep</Stat>
          )}
        </BannerStats>
        <BannerHint>Tap for breakdown</BannerHint>
      </RecoveryBanner>
    );
  }

  return (
    <CrashBanner
      type="button"
      role="status"
      aria-live="polite"
      onClick={() => {
        setBannerExpiresAt(null);
        modal.open(<CrashDetail summary={outcome} />, {
          title: `${outcome.vesselName || "Vessel"} destroyed`,
          width: "560px",
        });
      }}
    >
      <BannerLabel $variant="crashed">VESSEL DESTROYED</BannerLabel>
      <BannerVessel>{outcome.vesselName || "Untitled"}</BannerVessel>
      <BannerStats>
        {outcome.partsLostCount > 0 && (
          <Stat>-{outcome.partsLostCount} parts</Stat>
        )}
        {outcome.kerbalsKilled.length > 0 && (
          <Stat>{outcome.kerbalsKilled.length} KIA</Stat>
        )}
      </BannerStats>
      <BannerHint>Tap for breakdown</BannerHint>
    </CrashBanner>
  );
}

// ── Recovery detail modal ─────────────────────────────────────────────────

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
        <TotalsTable>
          <TotalsHeader>
            <span />
            <TotalsHeadCell>Gained</TotalsHeadCell>
            <TotalsHeadCell>Total</TotalsHeadCell>
          </TotalsHeader>
          <TotalsRow>
            <TotalLabel>Funds</TotalLabel>
            <TotalGained>
              +{Math.round(summary.fundsEarned).toLocaleString()}
            </TotalGained>
            <TotalAbsolute>
              {Math.round(summary.totalFunds).toLocaleString()}
            </TotalAbsolute>
          </TotalsRow>
          <TotalsRow>
            <TotalLabel>Science</TotalLabel>
            <TotalGained>+{summary.scienceEarned.toFixed(1)}</TotalGained>
            <TotalAbsolute>{summary.totalScience.toFixed(1)}</TotalAbsolute>
          </TotalsRow>
          {summary.displayReputation && (
            <TotalsRow>
              <TotalLabel>Reputation</TotalLabel>
              <TotalGained>+{summary.reputationEarned.toFixed(1)}</TotalGained>
              <TotalAbsolute>
                {summary.totalReputation.toFixed(1)}
              </TotalAbsolute>
            </TotalsRow>
          )}
        </TotalsTable>
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

// ── Crash detail modal ────────────────────────────────────────────────────

function CrashDetail({ summary }: { summary: CrashSummary }) {
  return (
    <DetailWrap>
      <DetailHeader>
        <DetailTitle>{summary.vesselName || "Untitled Vessel"}</DetailTitle>
        <DetailMeta>
          {summary.what || summary.flightEndMode || "destroyed"}
          {summary.body && ` · ${summary.body}`}
          {summary.situation && ` · ${summary.situation}`}
        </DetailMeta>
      </DetailHeader>

      <Totals>
        <TotalRow>
          <TotalLabel>Parts lost</TotalLabel>
          <TotalValue>{summary.partsLostCount}</TotalValue>
        </TotalRow>
        <TotalRow>
          <TotalLabel>Highest altitude</TotalLabel>
          <TotalValue>
            {Math.round(summary.highestAltitude).toLocaleString()} m
          </TotalValue>
        </TotalRow>
        <TotalRow>
          <TotalLabel>Highest speed</TotalLabel>
          <TotalValue>
            {Math.round(summary.highestSpeed).toLocaleString()} m/s
          </TotalValue>
        </TotalRow>
        <TotalRow>
          <TotalLabel>Highest G</TotalLabel>
          <TotalValue>{summary.highestGee.toFixed(2)}</TotalValue>
        </TotalRow>
        {summary.groundDistance > 0 && (
          <TotalRow>
            <TotalLabel>Ground distance</TotalLabel>
            <TotalValue>
              {Math.round(summary.groundDistance).toLocaleString()} m
            </TotalValue>
          </TotalRow>
        )}
      </Totals>

      {summary.crewAboard.length > 0 && (
        <DetailSection>
          <SectionTitle>Crew aboard ({summary.crewAboard.length})</SectionTitle>
          {summary.crewAboard.map((name) => (
            <DetailRow key={name}>
              <DetailRowTitle>{name}</DetailRowTitle>
              <DetailRowValue
                style={{
                  color: summary.kerbalsKilled.includes(name)
                    ? "var(--color-status-nogo-fg)"
                    : "var(--color-text-muted)",
                }}
              >
                {summary.kerbalsKilled.includes(name) ? "KIA" : "survived"}
              </DetailRowValue>
            </DetailRow>
          ))}
        </DetailSection>
      )}
    </DetailWrap>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────

const bannerBase = `
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.88);
  border-radius: 999px;
  font-family: inherit;
  font-size: 12px;
  color: var(--color-text-primary);
  cursor: pointer;
  animation: flightOutcomeBannerIn 320ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
  transform-origin: right center;
  will-change: transform, opacity;
  white-space: nowrap;

  &:hover {
    background: rgba(20, 22, 26, 0.95);
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }

  @keyframes flightOutcomeBannerIn {
    from {
      opacity: 0;
      transform: translateX(40px) scaleX(0.6);
    }
    60% {
      opacity: 1;
    }
    to {
      opacity: 1;
      transform: translateX(0) scaleX(1);
    }
  }
`;

const RecoveryBanner = styled.button`
  ${bannerBase}
  border: 1px solid var(--color-status-go-fg);

  &:focus-visible {
    outline: 2px solid var(--color-status-go-fg);
    outline-offset: 2px;
  }
`;

const CrashBanner = styled.button`
  ${bannerBase}
  border: 1px solid var(--color-status-nogo-fg);

  &:focus-visible {
    outline: 2px solid var(--color-status-nogo-fg);
    outline-offset: 2px;
  }
`;

const BannerLabel = styled.span<{ $variant: "recovered" | "crashed" }>`
  font-size: 10px;
  letter-spacing: 0.12em;
  color: ${({ $variant }) =>
    $variant === "crashed"
      ? "var(--color-status-nogo-fg)"
      : "var(--color-status-go-fg)"};
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

const TotalsTable = styled.div`
  display: grid;
  grid-template-columns: minmax(80px, auto) 1fr 1fr;
  column-gap: 16px;
  row-gap: 4px;
  align-items: baseline;
`;

const TotalsHeader = styled.div`
  display: contents;
`;

const TotalsHeadCell = styled.span`
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  text-align: right;
`;

const TotalsRow = styled.div`
  display: contents;
`;

const TotalLabel = styled.span`
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
`;

const TotalGained = styled.span`
  font-size: var(--font-size-base);
  color: var(--color-status-go-fg);
  font-variant-numeric: tabular-nums;
  text-align: right;
`;

const TotalAbsolute = styled.span`
  font-size: var(--font-size-base);
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
  text-align: right;
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
