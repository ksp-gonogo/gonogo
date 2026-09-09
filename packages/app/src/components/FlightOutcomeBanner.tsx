import { useTelemetry } from "@ksp-gonogo/core";
import { useFlight } from "@ksp-gonogo/data";
import { useStream } from "@ksp-gonogo/sitrep-client";
import {
  type CrashReport,
  isValue,
  type RecoveryReport,
  type Value,
} from "@ksp-gonogo/sitrep-sdk";
import { useModal } from "@ksp-gonogo/ui";
import { magnitudeOf, SectionTitle, Unit } from "@ksp-gonogo/ui-kit";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";

/**
 * Ephemeral top-of-viewport banner that fires when a fresh flight-end
 * snapshot lands: either a recovery (`recovery.lastSummary`) or a
 * crash (`crash.lastCrash`). Both outcome kinds flow through this
 * single component so flight endings share the same UI slot.
 *
 * Auto-dismisses after VISIBLE_MS; tap to pin the detail modal.
 * On a new-flight transition, the announce baseline is reset to the
 * current sticky outcome's UT, so the previous flight's recovery
 * never re-triggers the banner: only an outcome captured after the
 * new flight started will fire.
 */

const VISIBLE_MS = 10_000;

// ── Reading the two payloads ─────────────────────────────────────────────

/**
 * `recovery.lastSummary` and `crash.lastCrash` are typed by the generated
 * contract (`RecoveryReport`, `CrashReport`), and `useTelemetry` hands each
 * one back under its own type. This file therefore names no field shapes of
 * its own, and reads the reports directly.
 *
 * It used to. Two local interfaces of plain numbers restated both payloads
 * field-for-field, and a pair of `(raw: unknown)` parsers rebuilt each report
 * into them through `num(v) = typeof v === "number" ? v : 0`. That threw the
 * topic's type away at the door, so nothing could check the mirror against the
 * contract, and the two disagreed: every quantity on both payloads is a
 * `Value` by the time the banner reads it, because the wire carries a bare
 * number and `wrapUnits` wraps it on decode from the generated unit maps.
 * `typeof v === "number"` saw an object and substituted zero for all of them.
 * Recoveries paid 0 funds, 0 science and 0 rep, crashes flew to 0 m at 0 m/s,
 * every breakdown row read 0, part groups collapsed to "×1", and both UTs read
 * 0, which is what made the newest-outcome pick below compare 0 with 0 and
 * announce a recovery for a flight that ended in a crater.
 *
 * A hand-maintained mirror of a contract type is a second authority for the
 * wire's shape. Do not reintroduce one.
 */

/**
 * A declared quantity as the operator should see it: the `Value` itself when
 * it arrived, and `null` when it did not.
 *
 * Never a zero. "Recovered, 0 funds" and "recovered, funds unknown" are
 * different news, and `Unit` renders the second as the null token rather than
 * as a measurement nobody took.
 *
 * `magnitudeOf` is the same rule for the few reads that compare or count
 * rather than display.
 */
function q(v: unknown): Value | null {
  return isValue(v) ? v : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** A producer that omitted a list sent nothing, not an empty list, and the
 * two read the same to everything downstream. */
function list<T>(v: readonly T[] | undefined): readonly T[] {
  return Array.isArray(v) ? v : [];
}

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((entry): entry is string => typeof entry === "string");
}

/** A gain, signed only when there is one to sign. An absent reading reaches
 * `Unit` as the null token, which a leading "+" would misdescribe. */
function Gain({ value }: { value: Value | null }): ReactNode {
  return (
    <>
      {value ? "+" : null}
      <Unit value={value} />
    </>
  );
}

// crash.lastCrash only ever carries notable-vessel crashes: the mod
// filters debris / flags / non-vessels at the source, so the banner
// trusts whatever it receives and never second-guesses by name or type.
type Outcome =
  | { kind: "recovered"; ut: number | null; report: RecoveryReport }
  | { kind: "crashed"; ut: number | null; report: CrashReport };

// ── Component ────────────────────────────────────────────────────────────

export function FlightOutcomeBanner() {
  const recoveryHasRecent = useStream<boolean>("recovery.hasRecent") === true;
  const recoveryReading = useTelemetry("recovery.lastSummary");
  const crashHasRecent = useStream<boolean>("crash.hasRecent") === true;
  const crashReading = useTelemetry("crash.lastCrash");
  /**
   * A `Reading` is not its payload, and the deleted parsers took `unknown`, so
   * handing them the whole reading produced no type error at all: the parse failed
   * its shape checks and the banner stopped appearing. Branched explicitly here
   * rather than through a helper, because this package cannot reach
   * `@ksp-gonogo/components`' internals and two sites do not justify moving that
   * file.
   *
   * Both are records of an event that already happened, so the last one received is
   * still true: a recovery does not un-happen because the link went quiet. The
   * `hasRecent` gates above already decide whether there is anything to show.
   *
   * `unowned` joins the two absences and says nothing extra, which is right for this
   * one surface: the banner is transient chrome that renders only when its `hasRecent`
   * gate fires, and that gate reads a topic from the same pair. A build with no outcome
   * channels leaves the banner silent rather than showing a diagnostic nobody asked for,
   * and the warning the client logs on the unowned subscribe is where an author finds out.
   */
  const recoveryRaw =
    recoveryReading.state === "pending" ||
    recoveryReading.state === "unowned" ||
    recoveryReading.state === "absent"
      ? undefined
      : recoveryReading.value;
  const crashRaw =
    crashReading.state === "pending" ||
    crashReading.state === "unowned" ||
    crashReading.state === "absent"
      ? undefined
      : crashReading.value;
  const currentFlight = useFlight();

  const recovery: Outcome | null = useMemo(() => {
    if (!recoveryHasRecent || !recoveryRaw) return null;
    return {
      kind: "recovered",
      ut: magnitudeOf(recoveryRaw.capturedAtUT),
      report: recoveryRaw,
    };
  }, [recoveryHasRecent, recoveryRaw]);
  const crash: Outcome | null = useMemo(() => {
    if (!crashHasRecent || !crashRaw) return null;
    return { kind: "crashed", ut: magnitudeOf(crashRaw.ut), report: crashRaw };
  }, [crashHasRecent, crashRaw]);

  // Pick the most recent outcome. Both UTs come off the same KSP clock, so
  // where both arrived the later one is the flight that just ended.
  //
  // A UT that did not arrive cannot be ordered against one that did.
  // The crash wins that case: announcing a recovery for a vessel that
  // cratered is the worse of the two ways to be wrong.
  const outcome: Outcome | null = useMemo(() => {
    if (recovery && crash) {
      if (crash.ut === null || recovery.ut === null) return crash;
      return crash.ut > recovery.ut ? crash : recovery;
    }
    return recovery ?? crash ?? null;
  }, [recovery, crash]);

  // Banner state. lastAnnouncedRef is the (kind, ut) we last fired the
  // banner for; on a new-flight transition we baseline it to the current
  // sticky outcome so the previous flight's outcome doesn't re-fire.
  const lastAnnouncedRef = useRef<{ kind: string; ut: number | null } | null>(
    null,
  );
  const flightIdRef = useRef<string | null>(null);
  const [bannerExpiresAt, setBannerExpiresAt] = useState<number | null>(null);
  const modal = useModal();

  useEffect(() => {
    const nextFlightId = currentFlight?.id ?? null;
    const prevFlightId = flightIdRef.current;
    if (prevFlightId === nextFlightId) return;
    flightIdRef.current = nextFlightId;
    // Baseline the announce key only on a true flight switch (one non-null
    // flight to another non-null flight). Transitions involving null,
    // mount-time bootstrap, or a flight ending into "no flight", must not
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
    const summary = outcome.report;
    return (
      <RecoveryBanner
        type="button"
        role="status"
        aria-live="polite"
        onClick={() => {
          setBannerExpiresAt(null);
          modal.open(<RecoveryDetail summary={summary} />, {
            title: `${str(summary.vesselName) || "Vessel"} recovered`,
            width: "640px",
          });
        }}
      >
        <BannerLabel $variant="recovered">VESSEL RECOVERED</BannerLabel>
        <BannerVessel>{str(summary.vesselName) || "Untitled"}</BannerVessel>
        <BannerStats>
          <BannerStat>
            <Gain value={q(summary.fundsEarned)} />
          </BannerStat>
          <BannerStat>
            <Gain value={q(summary.scienceEarned)} />
          </BannerStat>
          {summary.displayReputation === true && (
            <BannerStat>
              <Gain value={q(summary.reputationEarned)} />
            </BannerStat>
          )}
        </BannerStats>
        <BannerHint>Tap for breakdown</BannerHint>
      </RecoveryBanner>
    );
  }

  const summary = outcome.report;
  const partsLostCount = list(summary.partsLost).length;
  const kerbalsKilled = stringList(summary.kerbalsKilled);
  return (
    <CrashBanner
      type="button"
      role="status"
      aria-live="polite"
      onClick={() => {
        setBannerExpiresAt(null);
        modal.open(<CrashDetail summary={summary} />, {
          title: `${str(summary.vesselName) || "Vessel"} destroyed`,
          width: "560px",
        });
      }}
    >
      <BannerLabel $variant="crashed">VESSEL DESTROYED</BannerLabel>
      <BannerVessel>{str(summary.vesselName) || "Untitled"}</BannerVessel>
      <BannerStats>
        {partsLostCount > 0 && <BannerStat>-{partsLostCount} parts</BannerStat>}
        {kerbalsKilled.length > 0 && (
          <BannerStat>{kerbalsKilled.length} KIA</BannerStat>
        )}
      </BannerStats>
      <BannerHint>Tap for breakdown</BannerHint>
    </CrashBanner>
  );
}

// ── Recovery detail modal ─────────────────────────────────────────────────

function RecoveryDetail({ summary }: { summary: RecoveryReport }) {
  const scienceBreakdown = list(summary.scienceBreakdown);
  const crewBreakdown = list(summary.crewBreakdown);
  const partBreakdown = list(summary.partBreakdown);
  const resourceBreakdown = list(summary.resourceBreakdown);
  return (
    <DetailWrap>
      <DetailHeader>
        <DetailTitle>
          {str(summary.vesselName) || "Untitled Vessel"}
        </DetailTitle>
        <DetailMeta>
          {str(summary.recoveryLocation)} · {str(summary.recoveryFactor)}
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
              <Gain value={q(summary.fundsEarned)} />
            </TotalGained>
            <TotalAbsolute>
              <Unit value={q(summary.totalFunds)} />
            </TotalAbsolute>
          </TotalsRow>
          <TotalsRow>
            <TotalLabel>Science</TotalLabel>
            <TotalGained>
              <Gain value={q(summary.scienceEarned)} />
            </TotalGained>
            <TotalAbsolute>
              <Unit value={q(summary.totalScience)} />
            </TotalAbsolute>
          </TotalsRow>
          {summary.displayReputation === true && (
            <TotalsRow>
              <TotalLabel>Reputation</TotalLabel>
              <TotalGained>
                <Gain value={q(summary.reputationEarned)} />
              </TotalGained>
              <TotalAbsolute>
                <Unit value={q(summary.totalReputation)} />
              </TotalAbsolute>
            </TotalsRow>
          )}
        </TotalsTable>
      </Totals>

      {scienceBreakdown.length > 0 && (
        <DetailSection>
          <SectionTitle as="h3" $rule>
            Science gathered
          </SectionTitle>
          {scienceBreakdown.map((s) => (
            <DetailRow key={s.subjectId}>
              <DetailRowTitle>
                {str(s.subjectTitle) || str(s.subjectId)}
              </DetailRowTitle>
              <DetailRowValue>
                <Gain value={q(s.scienceAmount)} />
              </DetailRowValue>
            </DetailRow>
          ))}
        </DetailSection>
      )}

      {crewBreakdown.length > 0 && (
        <DetailSection>
          <SectionTitle as="h3" $rule>
            Crew
          </SectionTitle>
          {crewBreakdown.map((c) => {
            const levelsGained = magnitudeOf(c.levelsGained);
            const newLevel = magnitudeOf(c.newLevel);
            return (
              <DetailRow key={str(c.name)}>
                <DetailRowTitle>
                  {str(c.name)}
                  {c.isTourist === true ? " (tourist)" : ` · ${str(c.trait)}`}
                </DetailRowTitle>
                <DetailRowValue>
                  <Gain value={q(c.xpGained)} /> XP
                  {levelsGained !== null &&
                    levelsGained > 0 &&
                    newLevel !== null &&
                    ` · L${newLevel}`}
                </DetailRowValue>
              </DetailRow>
            );
          })}
        </DetailSection>
      )}

      {partBreakdown.length > 0 && (
        <DetailSection>
          <SectionTitle as="h3" $rule>
            Parts ({partBreakdown.length})
          </SectionTitle>
          {partBreakdown.map((p) => {
            const count = magnitudeOf(p.count);
            return (
              <DetailRow key={str(p.partName)}>
                <DetailRowTitle>
                  {str(p.partTitle) || str(p.partName)}
                  {count !== null && count > 1 && ` ×${count}`}
                </DetailRowTitle>
                <DetailRowValue>
                  <Unit value={q(p.totalValue)} />
                </DetailRowValue>
              </DetailRow>
            );
          })}
        </DetailSection>
      )}

      {resourceBreakdown.length > 0 && (
        <DetailSection>
          <SectionTitle as="h3" $rule>
            Resources
          </SectionTitle>
          {resourceBreakdown.map((r) => (
            <DetailRow key={str(r.resourceName)}>
              <DetailRowTitle>
                {str(r.resourceName)} · <Unit value={q(r.amount)} />
              </DetailRowTitle>
              <DetailRowValue>
                <Unit value={q(r.totalValue)} />
              </DetailRowValue>
            </DetailRow>
          ))}
        </DetailSection>
      )}
    </DetailWrap>
  );
}

// ── Crash detail modal ────────────────────────────────────────────────────

function CrashDetail({ summary }: { summary: CrashReport }) {
  const stats = summary.flightStats;
  const crewAboard = stringList(summary.crewAboard);
  const kerbalsKilled = stringList(summary.kerbalsKilled);
  return (
    <DetailWrap>
      <DetailHeader>
        <DetailTitle>
          {str(summary.vesselName) || "Untitled Vessel"}
        </DetailTitle>
        <DetailMeta>
          {str(summary.what) || str(stats?.flightEndMode) || "destroyed"}
          {summary.body && ` · ${str(summary.body)}`}
          {summary.situation && ` · ${str(summary.situation)}`}
        </DetailMeta>
      </DetailHeader>

      <Totals>
        <TotalRow>
          <TotalLabel>Parts lost</TotalLabel>
          <TotalValue>{list(summary.partsLost).length}</TotalValue>
        </TotalRow>
        <TotalRow>
          <TotalLabel>Highest altitude</TotalLabel>
          <TotalValue>
            <Unit value={q(stats?.highestAltitude)} />
          </TotalValue>
        </TotalRow>
        <TotalRow>
          <TotalLabel>Highest speed</TotalLabel>
          <TotalValue>
            <Unit value={q(stats?.highestSpeed)} />
          </TotalValue>
        </TotalRow>
        <TotalRow>
          <TotalLabel>Highest G</TotalLabel>
          <TotalValue>
            <Unit value={q(stats?.highestGee)} />
          </TotalValue>
        </TotalRow>
        {/* Rendered whether or not the vessel travelled: a ground distance of
            zero is a reading (it came down where it went up), and it is the
            absent case, not the zero, that this row now hides nothing about. */}
        <TotalRow>
          <TotalLabel>Ground distance</TotalLabel>
          <TotalValue>
            <Unit value={q(stats?.groundDistance)} />
          </TotalValue>
        </TotalRow>
      </Totals>

      {crewAboard.length > 0 && (
        <DetailSection>
          <SectionTitle as="h3" $rule>
            Crew aboard ({crewAboard.length})
          </SectionTitle>
          {crewAboard.map((name) => (
            <DetailRow key={name}>
              <DetailRowTitle>{name}</DetailRowTitle>
              <DetailRowValue
                style={{
                  color: kerbalsKilled.includes(name)
                    ? "var(--color-status-nogo-fg)"
                    : "var(--color-text-muted)",
                }}
              >
                {kerbalsKilled.includes(name) ? "KIA" : "survived"}
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
  gap: var(--gap-section);
  /* Rungs, not --inset-surface. The floating-chrome band on the 16px gutter
     lock, the same one the alarm banners hold: this pill overlays the
     dashboard, and taking it to (6,8) would halve the gutter its text reads
     against to make a ratchet number smaller. */
  padding: var(--space-8) var(--space-16);
  background: rgba(0, 0, 0, 0.88);
  border-radius: var(--radius-pill);
  font-family: inherit;
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  cursor: pointer;
  animation: flightOutcomeBannerIn var(--duration-entrance) var(--ease-entrance)
    forwards;
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
  font-size: var(--font-size-2xs);
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
  gap: var(--gap-related);
`;

const BannerStat = styled.span`
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
`;

const BannerHint = styled.span`
  color: var(--color-text-faint);
  font-size: var(--font-size-2xs);
  letter-spacing: 0.06em;
`;

// ── Modal detail styles ───────────────────────────────────────────────────

const DetailWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
  min-width: 480px;
  max-width: 640px;
  max-height: 70vh;
  overflow-y: auto;
`;

const DetailHeader = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
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
  gap: var(--gap-related);
  padding: var(--inset-surface);
  background: var(--color-surface-raised);
  border-radius: var(--radius-sm);
`;

const TotalRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
`;

const TotalsTable = styled.div`
  display: grid;
  grid-template-columns: minmax(80px, auto) 1fr 1fr;
  column-gap: var(--gap-section);
  row-gap: var(--gap-related);
  align-items: baseline;
`;

const TotalsHeader = styled.div`
  display: contents;
`;

const TotalsHeadCell = styled.span`
  font-size: var(--font-size-2xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  text-align: right;
`;

const TotalsRow = styled.div`
  display: contents;
`;

const TotalLabel = styled.span`
  font-size: var(--font-size-xs);
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
  gap: var(--gap-related);
`;

const DetailRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--gap-related);
  padding: var(--space-4) 0;
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
