import type { ActionDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  type PorkchopCell,
  registerComponent,
  type TransferSolution,
  useActionInput,
  useTelemetry,
} from "@ksp-gonogo/core";
import { observedAt, type Reading, useViewUt } from "@ksp-gonogo/sitrep-client";
import { TargetKind, value } from "@ksp-gonogo/sitrep-sdk";
import { Placeholder } from "@ksp-gonogo/ui";
import {
  Badge,
  Button,
  FieldLabel,
  FieldRow,
  KSP_DAY_SECONDS,
  KSP_YEAR_DAYS,
  NULL_DISPLAY,
  Panel,
  Select,
  type Severity,
  Unit,
  Value,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useId, useMemo, useState } from "react";
import styled from "styled-components";
import { useCelestialBodies } from "../SystemView/useCelestialBodies";
import { useAlarmCreator } from "../shared/AlarmsLauncher";
import {
  buildTransferPorkchop,
  computeTransfer,
  type ReachEntry,
  type ReachVerdict,
  reachEntries,
  reachVerdict,
  type TransferWindowEntry,
  transferDestinations,
  upcomingWindows,
} from "./transferData";

/**
 * Transfer Window: interplanetary/interlunar departure planning. Client-derived
 * from the body Keplerian elements already on the wire (`system.bodies`), no mod
 * channel. Three linked instruments:
 *
 *  1. the DIAL: the live "right now" phase relationship (current vs ideal);
 *  2. the WINDOWS LIST: the next several departure windows to the target
 *     (countdown / Δv / transfer time); select a row to focus the chart on it
 *     and expand its detail + a set-alarm option;
 *  3. the PORKCHOP: the departure×arrival Δv surface for the selected window,
 *     with per-cell hover.
 *
 * The list ↔ chart link teaches the chart: pick a window, see its Δv surface.
 */

const WINDOW_COUNT = 5;

/**
 * UT seconds the reach list's phase solve is quantised to. A minute of game time
 * moves an interplanetary phase angle by nothing an operator can read, and the
 * alternative is re-solving every destination on every frame the clock advances.
 */
const REACH_RECOMPUTE_UT = 60;

const VERDICT_LABEL: Record<ReachVerdict, string> = {
  go: "GO",
  "one-way": "ONE WAY",
  marginal: "MARGINAL",
  no: "NO",
};

/**
 * `one-way` is deliberately a WARNING and not a failure: a flyby or an impactor is
 * a real mission, and colouring it as a refusal would tell the operator the wrong
 * thing about what their craft can do. `marginal` is the coplanar model declining
 * to commit, which is the same shape of statement.
 */
const VERDICT_SEVERITY: Record<ReachVerdict, Severity | undefined> = {
  go: "nominal",
  "one-way": "warning",
  marginal: "warning",
  no: "critical",
};

interface TransferWindowConfig {
  /** Show the porkchop plot. Default: true. */
  showPorkchop?: boolean;
  /** Alarm lead time in hours (warp steps down this far before the window). Default: 6. */
  leadHours?: number;
  /**
   * Δv held back from the reach verdicts (m/s). Default 0, so out of the box the
   * verdict is plain arithmetic on the whole vehicle figure and nobody inherits a
   * fudge factor they did not choose. Set it to reserve a lander's descent budget.
   */
  reserveDeltaV?: number;
}

/** Local mirror of the app's TimeTrigger shape (components can't import app). */
interface TimeTrigger {
  kind: "time";
  ut: number;
  leadSeconds: number;
}

const transferWindowActions = [
  {
    id: "cycleDestination",
    label: "Next Destination",
    accepts: ["button"],
    description: "Cycle the transfer destination to the next sibling body.",
  },
] as const satisfies readonly ActionDefinition[];

export type TransferWindowActions = typeof transferWindowActions;

// State-descriptive labels for the phase relationship: this is an instrument
// that SHOWS state, not one that issues commands. IDEAL: the phase is at the
// Hohmann ideal; NEAR: approaching it; FAR: well off it.
const STATUS_LABEL: Record<string, string> = {
  go: "IDEAL",
  soon: "NEAR",
  off: "FAR",
};

// off/FAR carries no severity: being far from a window is not an alarm, just
// "not yet", so it stays a decorative grey chip via an undefined severity.
const STATUS_SEVERITY: Record<string, Severity | undefined> = {
  go: "nominal",
  soon: "warning",
  off: undefined,
};

// Days and years here are Kerbin's (6h, 426d), not Earth's: a transfer to
// Duna is quoted in the same calendar the game's own map view and the
// dashboard's mission clock use.
const fmtDays = (sec: number): string =>
  `${Math.round(sec / KSP_DAY_SECONDS)} d`;

const fmtCountdown = (sec: number): string => {
  const d = sec / KSP_DAY_SECONDS;
  if (d < 1) return "now";
  if (d < 1000) return `in ${Math.round(d)} d`;
  return `in ${(d / KSP_YEAR_DAYS).toFixed(1)} y`;
};

/** Whether a reading went stale, as opposed to never having arrived. */
function notCurrent<T>(reading: Reading<T>): boolean {
  return reading.state === "stale";
}

/**
 * The value of a FACT: something that stays true until an event changes it, and no
 * event can reach us down a link that is not delivering. `whenConfirmedNothing` is
 * what an `absent` tombstone means here, which is a different answer from `pending`
 * and must not collapse into it.
 */
function stillTrue<T, A>(
  reading: Reading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "reckonable") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

function TransferWindowComponent({
  config,
}: ComponentProps<TransferWindowConfig>) {
  const showPorkchop = config?.showPorkchop ?? true;
  const leadSeconds = (config?.leadHours ?? 6) * 3600;
  const reserveDeltaV = config?.reserveDeltaV ?? 0;

  /**
   * The parking orbit, and what of it survives the link going quiet.
   *
   * Two fields are read off this record and both are facts rather than
   * measurements. The reference body changes on an SOI transition; the elements
   * change under thrust or drag. Both are events, and no event reaches us down a
   * link that is not delivering. Keplerian elements in particular do not drift on
   * their own, which is what makes them elements, so the last ones received still
   * describe the orbit the craft is parked in.
   *
   * Nothing this widget JUDGES rests on them either, which is why holding them is
   * not a stale verdict in disguise. The dial, the IDEAL/NEAR/FAR badge and the
   * window countdowns are computed from the body catalogue propagated to the view
   * time (`transferStatus` takes a phase angle and nothing else), so the verdict
   * is current even when the vessel channel is not. The elements set the ejection
   * Δv alone, a planning figure for a departure days to years out, and that is a
   * number a readout can date: `orbitNotCurrent` captions it rather than blanking
   * a whole board that is otherwise live.
   */
  const orbitReading = useTelemetry("vessel.orbit");
  const orbit = stillTrue(orbitReading, undefined);
  const orbitNotCurrent = notCurrent(orbitReading);
  /**
   * "This vessel is not in an orbit" and "no orbit has reached us yet" are
   * different sentences. The pre-migration gate was `!orbit` and said "waiting" to
   * both, so a craft on the pad waited forever for telemetry that was never
   * coming. `absent` is the subject confirming it, so it gets its own wording.
   */
  const orbitConfirmedAbsent = orbitReading.state === "absent";
  const bodies = useCelestialBodies();
  // `.magnitude`: everything below treats the view time as a bare UT for arithmetic,
  // and the instant type earns nothing threaded through it. Unwrapped once, here.
  const viewUt = useViewUt();
  const nowUt = viewUt?.magnitude ?? 0;

  /**
   * The vehicle's Δv, and the third provenance on this panel.
   *
   * A DESCRIPTION in `LandingStatus`'s sense, and that doc names this exact
   * quantity: "how much delta-v there was" renders from a last-known value,
   * labelled. The operator's standing position settles the rest: we plan with what
   * we have, and running dry at execution is operator error. So a dated budget is
   * captioned, never withheld.
   *
   * It is dated more carefully than the parking orbit above, because the two decay
   * differently. Elements do not drift; only a burn or an SOI change moves them,
   * and both are events. A budget only ever falls, by burning, and rises solely by
   * staging or docking. So an old budget systematically OVER-states what is
   * reachable, and every error it makes promises a body the craft cannot get to.
   * Hence `budgetNotCurrent` hollows the verdict pips rather than only adding a
   * line of text: "GO, six minutes ago" must not read as "GO".
   *
   * No `withoutReckoning`. Nothing registers a reckoner for `dv.summary` today, so
   * this presents as `stale`, but the topic is deliberately absent from
   * `NEVER_RECKONABLE`: Δv against a burn rate is a real rate-integrable pairing,
   * and a list that had declined the model in advance would be the wrong default
   * the day someone writes it.
   */
  const budgetReading = useTelemetry("dv.summary");
  const budgetDeltaV =
    stillTrue(budgetReading, null)?.totalDvVac?.magnitude ?? null;
  const budgetNotCurrent = notCurrent(budgetReading);
  /** The stock Δv sim has no figure for this craft, as opposed to none having arrived. */
  const budgetConfirmedAbsent = budgetReading.state === "absent";
  const budgetAsOf = observedAt(budgetReading);
  // Stays in the algebra: an instant minus an instant is a duration, and `Unit`
  // renders it. Unwrapping here would type a unit symbol beside a number, which is
  // what `Unit` exists to prevent.
  const budgetAge = viewUt && budgetAsOf ? viewUt.minus(budgetAsOf) : null;
  const createAlarm = useAlarmCreator<TimeTrigger>();

  const origin = useMemo(
    () =>
      orbit?.referenceBodyIndex != null
        ? (bodies.find((b) => b.index === orbit.referenceBodyIndex) ?? null)
        : null,
    [bodies, orbit?.referenceBodyIndex],
  );

  const dests = useMemo(
    () => (origin ? transferDestinations(origin, bodies) : []),
    [origin, bodies],
  );

  // Seed the destination from the Target API: a targeted body defaults the
  // transfer to it. An explicit pick wins; otherwise the targeted body, then
  // the first sibling.
  /**
   * The roster is a fact, on TargetPicker's reasoning: bodies and vessels do not
   * stop existing because the link dropped, and which one is flagged current is
   * what we last told the craft and what it last confirmed. So a held list still
   * seeds the destination.
   *
   * `absent` needs no arm of its own here, unlike the orbit above: a confirmed
   * empty roster and a roster that has not arrived both mean nothing is targeted,
   * and the fall-through to the first sibling is already the answer to that.
   */
  const targetList = stillTrue(useTelemetry("target.available"), undefined);
  const targetBodyIndex = useMemo(
    () =>
      targetList?.entries.find((e) => e.isCurrent && e.kind === TargetKind.Body)
        ?.bodyIndex ?? null,
    [targetList],
  );

  const [destIndex, setDestIndex] = useState<number | null>(null);
  const dest = useMemo(
    () =>
      dests.find((d) => d.index === destIndex) ??
      (targetBodyIndex != null
        ? dests.find((d) => d.index === targetBodyIndex)
        : undefined) ??
      dests[0] ??
      null,
    [dests, destIndex, targetBodyIndex],
  );

  const cycleDestination = () => {
    if (dests.length === 0) return;
    const cur = dests.findIndex((d) => d.index === (dest?.index ?? -1));
    const next = dests[(cur + 1) % dests.length];
    if (next) setDestIndex(next.index);
  };

  useActionInput<TransferWindowActions>({
    cycleDestination: () => cycleDestination(),
  });

  const parkingRadius =
    orbit?.sma != null && orbit?.ecc != null
      ? orbit.sma.times(1 - orbit.ecc.magnitude).magnitude
      : null;

  const solution: TransferSolution | null = useMemo(
    () =>
      origin && dest && parkingRadius != null && Number.isFinite(parkingRadius)
        ? computeTransfer({ origin, dest, bodies, parkingRadius, nowUt })
        : null,
    [origin, dest, bodies, parkingRadius, nowUt],
  );

  // The base porkchop is windowed on the next window's ideal departure; its
  // optimum is that window's Δv, which seeds the windows list.
  const basePorkchop = useMemo(
    () =>
      origin && dest
        ? buildTransferPorkchop({
            origin,
            dest,
            bodies,
            nowUt,
            centerDepUt: solution?.departureUt,
          })
        : null,
    [origin, dest, bodies, nowUt, solution?.departureUt],
  );

  const windows = useMemo(
    () =>
      solution && basePorkchop
        ? upcomingWindows(solution, basePorkchop, nowUt, WINDOW_COUNT)
        : [],
    [solution, basePorkchop, nowUt],
  );

  const [selectedWindow, setSelectedWindow] = useState(0);
  // Reset the selection when the destination changes.
  const destKey = dest?.index ?? -1;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on destination change, not on selection.
  useEffect(() => setSelectedWindow(0), [destKey]);
  const selIdx = Math.min(selectedWindow, Math.max(0, windows.length - 1));
  const selected = windows[selIdx] ?? null;

  // Focus the porkchop on the selected window: window 0 is the base chart;
  /**
   * The reach list: every sibling, what it costs, and whether this craft affords it.
   *
   * Keyed on a COARSE view time rather than `nowUt`. `useViewUt` notifies at frame
   * rate whenever the clock moves, and the phase angle does not change meaningfully
   * inside a minute, so quantising here keeps a list of closed-form solves off the
   * per-frame path. The window countdowns it produces are quoted in whole days.
   */
  const reachUtBucket = Math.floor(nowUt / REACH_RECOMPUTE_UT);
  const reach = useMemo(
    () =>
      origin && parkingRadius != null && Number.isFinite(parkingRadius)
        ? reachEntries({
            origin,
            bodies,
            parkingRadius,
            nowUt: reachUtBucket * REACH_RECOMPUTE_UT,
          })
        : [],
    [origin, bodies, parkingRadius, reachUtBucket],
  );

  // later windows rebuild centred on their own departure so their Δv surface
  // shows (each is a synodic period later, same bowl shape).
  const focusedPorkchop = useMemo(() => {
    if (!origin || !dest || !selected || selected.index === 0) {
      return basePorkchop;
    }
    return buildTransferPorkchop({
      origin,
      dest,
      bodies,
      nowUt,
      centerDepUt: selected.departureUt,
    });
  }, [origin, dest, bodies, nowUt, selected, basePorkchop]);

  if (!orbit || !origin) {
    return (
      <Panel panelTitle="Transfer Window">
        <Placeholder>
          {orbitConfirmedAbsent
            ? "No parking orbit: the vessel reports it is not in one."
            : "Waiting for vessel orbit..."}
        </Placeholder>
      </Panel>
    );
  }
  if (dests.length === 0 || !dest) {
    return (
      <Panel panelTitle="Transfer Window">
        <Placeholder>
          No transfer destinations. {origin.name ?? "The origin body"} has no
          sibling bodies to transfer to.
        </Placeholder>
      </Panel>
    );
  }

  return (
    <Panel
      panelTitle="Transfer Window"
      panelAside={
        <FieldRow>
          {/*
           * The budget sits with the verdicts it produced, on the same reasoning as
           * the funds readout on any widget that spends money: an operator reading
           * "NO" should not have to find another panel to learn what number said so.
           * `vac` is on screen because the ISP assumption is part of the figure.
           */}
          {budgetDeltaV != null && (
            <BudgetReadout>
              <FieldLabel as="span">Budget</FieldLabel>
              <Unit value={value("m/s", budgetDeltaV)} decimals={0} /> vac
              {reserveDeltaV > 0 && (
                <Muted>
                  {" reserve "}
                  <Unit value={value("m/s", reserveDeltaV)} decimals={0} />
                </Muted>
              )}
            </BudgetReadout>
          )}
          <FieldLabel htmlFor="transfer-dest">
            {origin.name ?? "Origin"} to
          </FieldLabel>
          <RouteSelect
            id="transfer-dest"
            value={dest.index}
            onChange={(e) => setDestIndex(Number(e.target.value))}
          >
            {dests.map((d) => (
              <option key={d.index} value={d.index}>
                {d.name ?? `Body ${d.index}`}
              </option>
            ))}
          </RouteSelect>
        </FieldRow>
      }
    >
      <Body>
        {orbitNotCurrent && (
          // Dated, not withheld. Says which half of the panel it applies to,
          // because a bare "not current" over a live dial would read as a dead
          // instrument: the phase relationship and the window times come off the
          // body catalogue and are as current as the view clock.
          <Value tone="warn" size="xs" role="status" aria-live="polite">
            Parking orbit no longer current: Δv is from the last known elements.
            Phase and window times stay live.
          </Value>
        )}
        {/*
         * The budget, beside the verdicts it produced. Three different sentences,
         * and the widget must not collapse them: a dated figure still plans, a
         * confirmed-absent one says the stock sim has nothing for this craft, and
         * silence says we have not heard. Only the first renders a number.
         */}
        {budgetNotCurrent && budgetDeltaV != null && (
          <Value tone="warn" size="xs" role="status" aria-live="polite">
            Budget last heard{" "}
            {budgetAge ? <Unit value={budgetAge} decimals={0} /> : "some time"}{" "}
            ago. Δv only falls as you burn, so reach here can only be
            optimistic.
          </Value>
        )}
        {budgetConfirmedAbsent && (
          <Value tone="warn" size="xs" role="status" aria-live="polite">
            No Δv figure for this craft: the stock simulation reports none, so
            costs are shown without a verdict.
          </Value>
        )}
        {solution ? (
          // Responsive on the body's own width (container query): stacked when
          // narrow: dial + list, then the chart below; side-by-side when wide,
          // dial + list on the left, the chart flowing to the right. The
          // chart holds a minimum size and grows to fill whatever space is free.
          <ContentGrid>
            <LeftCol>
              <NowRow>
                <PhaseDial solution={solution} />
                <NowFacts role="status" aria-live="polite">
                  <NowLabel>Current phase</NowLabel>
                  <NowValue>
                    <Unit
                      value={value("°", solution.currentPhaseDeg)}
                      decimals={1}
                    />
                    <Muted>
                      {" / ideal "}
                      <Unit
                        value={value("°", solution.idealPhaseDeg)}
                        decimals={1}
                      />
                    </Muted>
                  </NowValue>
                  <Badge severity={STATUS_SEVERITY[solution.status]}>
                    {STATUS_LABEL[solution.status]}
                  </Badge>
                </NowFacts>
              </NowRow>

              <WindowsList
                windows={windows}
                selectedIndex={selIdx}
                onSelect={setSelectedWindow}
                destName={dest.name ?? "target"}
                createAlarm={
                  createAlarm
                    ? (w) =>
                        createAlarm({
                          name: `Transfer: ${origin.name} to ${dest.name}`,
                          trigger: {
                            kind: "time",
                            ut: w.departureUt,
                            leadSeconds,
                          },
                        })
                    : null
                }
              />

              <ReachList
                entries={reach}
                originName={origin.name ?? "here"}
                budgetDeltaV={budgetDeltaV}
                reserveDeltaV={reserveDeltaV}
                budgetNotCurrent={budgetNotCurrent}
              />
            </LeftCol>

            {showPorkchop && focusedPorkchop && (
              <Porkchop grid={focusedPorkchop} nowUt={nowUt} />
            )}
          </ContentGrid>
        ) : (
          <Placeholder>Waiting for orbital elements...</Placeholder>
        )}
      </Body>
    </Panel>
  );
}

function WindowsList({
  windows,
  selectedIndex,
  onSelect,
  destName,
  createAlarm,
}: {
  windows: TransferWindowEntry[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  destName: string;
  createAlarm: ((w: TransferWindowEntry) => void) | null;
}) {
  if (windows.length === 0) return null;
  return (
    <ListWrap>
      <ListTitle>Windows to {destName}</ListTitle>
      <List>
        {windows.map((w) => {
          const isSel = w.index === selectedIndex;
          return (
            <ListItem key={w.index}>
              <WindowRow
                type="button"
                $selected={isSel}
                aria-expanded={isSel}
                onClick={() => onSelect(w.index)}
              >
                <ColWait>{fmtCountdown(w.waitSeconds)}</ColWait>
                <ColDv>
                  <Unit value={value("m/s", w.deltaV)} />
                </ColDv>
                <ColTof>{fmtDays(w.transferTimeSec)}</ColTof>
              </WindowRow>
              {isSel && (
                <Expander>
                  <ExpRow>
                    <ExpLabel>Departs</ExpLabel>
                    <ExpValue>+{fmtDays(w.waitSeconds)}</ExpValue>
                  </ExpRow>
                  <ExpRow>
                    <ExpLabel>Arrives</ExpLabel>
                    <ExpValue>
                      +{fmtDays(w.waitSeconds + w.transferTimeSec)}
                    </ExpValue>
                  </ExpRow>
                  <ExpRow>
                    <ExpLabel>Transfer time</ExpLabel>
                    <ExpValue>{fmtDays(w.transferTimeSec)}</ExpValue>
                  </ExpRow>
                  <ExpRow>
                    <ExpLabel>Ejection Δv</ExpLabel>
                    <ExpValue>
                      <Unit
                        value={value("m/s", w.ejectionDeltaV)}
                        decimals={0}
                      />
                    </ExpValue>
                  </ExpRow>
                  <ExpRow>
                    <ExpLabel>Ejection angle</ExpLabel>
                    <ExpValue>
                      <Unit
                        value={value("°", w.ejectionAngleDeg)}
                        decimals={0}
                      />{" "}
                      to prograde
                    </ExpValue>
                  </ExpRow>
                  {createAlarm && (
                    <Button type="button" onClick={() => createAlarm(w)}>
                      Set window alarm
                    </Button>
                  )}
                </Expander>
              )}
            </ListItem>
          );
        })}
      </List>
    </ListWrap>
  );
}

/**
 * The reach list: which destinations this craft can get to on its current budget,
 * and roughly when.
 *
 * A table because it is genuinely tabular, sorted cheapest-first so the top row
 * answers "the nearest thing I can reach". The verdict column is DROPPED ENTIRELY
 * when there is no budget rather than filled with placeholders: an empty column
 * invites the reader to supply a verdict, and no verdict is available.
 */
function ReachList({
  entries,
  originName,
  budgetDeltaV,
  reserveDeltaV,
  budgetNotCurrent,
}: {
  entries: ReachEntry[];
  originName: string;
  budgetDeltaV: number | null;
  reserveDeltaV: number;
  budgetNotCurrent: boolean;
}) {
  if (entries.length === 0) return null;
  const haveBudget = budgetDeltaV != null;

  return (
    <ListWrap>
      <ListTitle id="reach-caption">Reach from {originName}</ListTitle>
      <ReachTable aria-describedby="reach-caption">
        <thead>
          <tr>
            <ReachTh scope="col">Destination</ReachTh>
            <ReachTh scope="col">Δv needed</ReachTh>
            {haveBudget && <ReachTh scope="col">Affords</ReachTh>}
            <ReachTh scope="col">Window</ReachTh>
            <ReachTh scope="col">Transit</ReachTh>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const verdict = reachVerdict(entry, budgetDeltaV, reserveDeltaV);
            return (
              <tr key={entry.body.index}>
                <ReachTd>
                  {entry.body.name ?? `Body ${entry.body.index}`}
                </ReachTd>
                <ReachTdNum>
                  {entry.totalDeltaV != null ? (
                    <Unit
                      value={value("m/s", entry.totalDeltaV)}
                      decimals={0}
                    />
                  ) : (
                    NULL_DISPLAY
                  )}
                </ReachTdNum>
                {haveBudget && (
                  <ReachTd>
                    {verdict ? (
                      // Dated verdicts read as advisory rather than live. A stale
                      // budget can only over-state reach (Δv falls by burning), so
                      // "GO as of some minutes ago" must not wear the live GO
                      // colour.
                      <Badge
                        severity={
                          budgetNotCurrent
                            ? undefined
                            : VERDICT_SEVERITY[verdict]
                        }
                      >
                        {VERDICT_LABEL[verdict]}
                      </Badge>
                    ) : (
                      NULL_DISPLAY
                    )}
                  </ReachTd>
                )}
                <ReachTdNum>
                  {entry.waitSeconds != null
                    ? fmtCountdown(entry.waitSeconds)
                    : NULL_DISPLAY}
                </ReachTdNum>
                <ReachTdNum>
                  {entry.transferTimeSec != null
                    ? fmtDays(entry.transferTimeSec)
                    : NULL_DISPLAY}
                </ReachTdNum>
              </tr>
            );
          })}
        </tbody>
      </ReachTable>
      <ReachFooter>
        Coplanar circular model, plane change not included. Capture circularises
        10 km above the destination's atmosphere.
      </ReachFooter>
    </ListWrap>
  );
}

function PhaseDial({ solution }: { solution: TransferSolution }) {
  const R = 40;
  const cx = 50;
  const cy = 50;
  const point = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return { x: cx + R * Math.cos(a), y: cy - R * Math.sin(a) };
  };
  const cur = point(solution.currentPhaseDeg);
  const ideal = point(solution.idealPhaseDeg);
  const color =
    solution.status === "go"
      ? "var(--color-accent-fg)"
      : solution.status === "soon"
        ? "var(--color-status-warning-bg)"
        : "var(--color-text-dim)";
  return (
    <PhaseDialSvg
      viewBox="0 0 100 100"
      role="img"
      aria-label={`Current phase ${solution.currentPhaseDeg.toFixed(0)} degrees, ideal ${solution.idealPhaseDeg.toFixed(0)} degrees, ${STATUS_LABEL[solution.status]}`}
    >
      <circle
        cx={cx}
        cy={cy}
        r={R}
        fill="none"
        stroke="var(--color-border-subtle)"
        strokeWidth={1}
      />
      <circle cx={cx + R} cy={cy} r={2.5} fill="var(--color-text-muted)" />
      <line
        x1={cx}
        y1={cy}
        x2={ideal.x}
        y2={ideal.y}
        stroke="var(--color-accent-fg)"
        strokeWidth={1}
        strokeDasharray="3 2"
      />
      <line
        x1={cx}
        y1={cy}
        x2={cur.x}
        y2={cur.y}
        stroke={color}
        strokeWidth={2}
      />
      <circle cx={cur.x} cy={cur.y} r={3} fill={color} />
    </PhaseDialSvg>
  );
}

// Continuous Δv → colour ramp: violet (the cheap optimum) sweeping through
// blue/cyan/green/yellow/orange to red (the worst). A smooth hue sweep with no
// discrete banding, so the bowl reads as smooth concentric shading. `t` is the
// capped, normalised Δv in [0,1].
const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
const rampColor = (t: number): string =>
  `hsl(${(258 * (1 - clamp01(t))).toFixed(1)}, 66%, 48%)`;

// Plot geometry (SVG user units). Margins leave room for the arrival ticks
// (left), departure ticks (bottom) and the Δv legend (right).
const VB_W = 360;
const VB_H = 300;
const M = { top: 12, right: 74, bottom: 34, left: 50 };
const PLOT_W = VB_W - M.left - M.right;
const PLOT_H = VB_H - M.top - M.bottom;

/** Three tick indices (first, middle, last) for an axis of `n` samples. */
const tickIndices = (n: number): number[] =>
  n <= 1 ? [0] : [...new Set([0, Math.floor((n - 1) / 2), n - 1])];

function Porkchop({
  grid,
  nowUt,
}: {
  grid: NonNullable<ReturnType<typeof buildTransferPorkchop>>;
  nowUt: number;
}) {
  const [hover, setHover] = useState<PorkchopCell | null>(null);
  const gradientId = useId();
  const cols = grid.cells.length; // departure axis (x), cells[i]
  const rows = grid.cells[0]?.length ?? 0; // arrival axis (y), cells[i][j]
  const min = grid.minDeltaV;
  const max = grid.maxDeltaV;
  if (cols === 0 || rows === 0 || min == null || max == null) return null;
  // Colour scale is capped near the optimum (min → min·1.8, but never past the
  // real max) so the low-Δv bullseye keeps full contour resolution; cells beyond
  // the cap (the far, off-ridge transfers) saturate in the top band, the way a
  // canonical porkchop clips its contours rather than letting outliers wash the
  // scale flat.
  const scaleMax = Math.min(max, min * 1.8);
  const scaleSpan = scaleMax - min || 1;
  const capped = scaleMax < max;
  const cellW = PLOT_W / cols;
  const cellH = PLOT_H / rows;
  const days = (sec: number) => Math.round(sec / KSP_DAY_SECONDS);
  const dayOffset = (ut: number) => days(ut - nowUt);
  const kms = (ms: number) => (ms / 1000).toFixed(1);

  // Cell → plot pixel. Departure increases left→right (i); arrival increases
  // bottom→top (j), so later arrivals sit at the top like a canonical porkchop.
  const cellX = (i: number) => M.left + i * cellW;
  const cellY = (j: number) => M.top + (rows - 1 - j) * cellH;

  const best = grid.best;

  return (
    <PorkchopWrap>
      <PorkchopTitle>Transfer Δv: departure vs arrival</PorkchopTitle>
      <Inspector aria-live="polite">
        {hover && hover.deltaV != null
          ? `Departs +${dayOffset(hover.depUt)}d · Arrives +${dayOffset(hover.arrUt)}d · Transfer ${days(hover.tofSec)}d · Δv ${kms(hover.deltaV)} km/s`
          : `Best ${best ? `${kms(best.deltaV)} km/s, depart +${dayOffset(best.depUt)}d` : NULL_DISPLAY} · hover a cell for its numbers.`}
      </Inspector>
      <MapBox>
        <MapSvg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Transfer Δv contour plot, departure against arrival date. Best transfer ${best ? `${Math.round(best.deltaV)} metres per second departing ${dayOffset(best.depUt)} days from now` : "none"}.`}
        >
          <defs>
            {/* Continuous legend ramp: worst (red) at top → cheap (violet) at
              bottom, matching the plot's colour scale. */}
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={rampColor(1)} />
              <stop offset="25%" stopColor={rampColor(0.75)} />
              <stop offset="50%" stopColor={rampColor(0.5)} />
              <stop offset="75%" stopColor={rampColor(0.25)} />
              <stop offset="100%" stopColor={rampColor(0)} />
            </linearGradient>
          </defs>
          {/* Background = the worst / off-scale (≥cap) colour. The whole plot is a
            wall of that colour and only the lower-Δv cells are painted on top,
            so the good transfers read as a clean blob that blends smoothly out
            to the background. Null (no-solution) cells stay background too. */}
          <rect
            x={M.left}
            y={M.top}
            width={PLOT_W}
            height={PLOT_H}
            fill={rampColor(1)}
            pointerEvents="none"
          />
          {/* lower-Δv cells, coloured on a smooth continuous gradient */}
          {grid.cells.map((col, i) =>
            col.map((c, j) => {
              if (c.deltaV == null) return null;
              const t = (c.deltaV - min) / scaleSpan; // 0 cheap → 1 dear
              if (t >= 1) return null; // at/above the cap → background
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: decorative plot cell (svg is role=img); hover is a pointer-only enhancement, the windows list is the accessible interactive surface.
                <rect
                  className="porkchop-cell"
                  key={`${c.depUt.toFixed(0)}-${c.arrUt.toFixed(0)}`}
                  x={cellX(i)}
                  y={cellY(j)}
                  width={cellW + 0.6}
                  height={cellH + 0.6}
                  fill={rampColor(t)}
                  onMouseEnter={() => setHover(c)}
                />
              );
            }),
          )}

          {/* best-transfer marker */}
          {best && (
            <g
              stroke="var(--color-accent-fg)"
              strokeWidth={1.4}
              fill="none"
              pointerEvents="none"
            >
              <circle
                cx={cellX(best.i) + cellW / 2}
                cy={cellY(best.j) + cellH / 2}
                r={4.5}
              />
            </g>
          )}

          {/* plot frame */}
          <rect
            x={M.left}
            y={M.top}
            width={PLOT_W}
            height={PLOT_H}
            fill="none"
            stroke="var(--color-border-subtle)"
            strokeWidth={1}
            pointerEvents="none"
          />

          {/* x axis: departure */}
          {tickIndices(cols).map((i) => (
            <text
              key={`xt-${i}`}
              x={cellX(i) + cellW / 2}
              y={M.top + PLOT_H + 12}
              fontSize={9}
              textAnchor="middle"
              fill="var(--color-text-dim)"
            >
              +{dayOffset(grid.departureUts[i])}
            </text>
          ))}
          <text
            x={M.left + PLOT_W / 2}
            y={VB_H - 4}
            fontSize={9}
            textAnchor="middle"
            fill="var(--color-text-muted)"
          >
            departure: days from now
          </text>

          {/* y axis: arrival */}
          {tickIndices(rows).map((j) => (
            <text
              key={`yt-${j}`}
              x={M.left - 6}
              y={cellY(j) + cellH / 2 + 3}
              fontSize={9}
              textAnchor="end"
              fill="var(--color-text-dim)"
            >
              +{dayOffset(grid.arrivalUts[j])}
            </text>
          ))}
          <text
            x={12}
            y={M.top + PLOT_H / 2}
            fontSize={9}
            textAnchor="middle"
            fill="var(--color-text-muted)"
            transform={`rotate(-90 12 ${M.top + PLOT_H / 2})`}
          >
            arrival: days from now
          </text>

          {/* Δv legend: a continuous gradient bar with a few value ticks */}
          <rect
            x={VB_W - M.right + 20}
            y={M.top}
            width={12}
            height={PLOT_H}
            fill={`url(#${gradientId})`}
          />
          <text
            x={VB_W - M.right + 38}
            y={M.top + 7}
            fontSize={9}
            textAnchor="start"
            fill="var(--color-text-dim)"
          >
            {capped ? "≥" : ""}
            {kms(scaleMax)}
          </text>
          <text
            x={VB_W - M.right + 38}
            y={M.top + PLOT_H / 2 + 3}
            fontSize={9}
            textAnchor="start"
            fill="var(--color-text-dim)"
          >
            {kms((min + scaleMax) / 2)}
          </text>
          <text
            x={VB_W - M.right + 38}
            y={M.top + PLOT_H}
            fontSize={9}
            textAnchor="start"
            fill="var(--color-text-dim)"
          >
            {kms(min)}
          </text>
          <text
            x={VB_W - M.right + 20}
            y={M.top + PLOT_H + 12}
            fontSize={9}
            textAnchor="start"
            fill="var(--color-text-muted)"
          >
            Δv km/s
          </text>
        </MapSvg>
      </MapBox>
    </PorkchopWrap>
  );
}

registerComponent<TransferWindowConfig>({
  id: "transfer-window",
  name: "Transfer Window",
  description:
    "Interplanetary/interlunar departure planner: a live phase dial, a list of upcoming transfer windows, and a linked departure/arrival Δv map. Client-derived from streamed body orbits.",
  tags: ["telemetry", "planning"],
  defaultSize: { w: 12, h: 20 },
  minSize: { w: 6, h: 10 },
  component: TransferWindowComponent,
  dataRequirements: [
    "system.bodies",
    "vessel.orbit",
    "target.available",
    "dv.summary",
  ],
  defaultConfig: { showPorkchop: true, leadHours: 6, reserveDeltaV: 0 },
  actions: transferWindowActions,
  pushable: true,
  requires: ["flight"],
});

export { TransferWindowComponent };

// Internal padding for the two boxes that draw their own edge: the selectable
// window row (a bordered button) and the expander beneath it. Panel.Body owns
// the panel-wide inset now, so this is only about the gap between a box's
// border and its own text. One constant, two call sites, so the pair cannot
// drift apart.
const TEXT_PAD = "var(--space-12)";
// Container-query breakpoint (body inline-size) at which the chart flows from
// under the list (stacked) to beside it (side-by-side).
const WIDE_AT = "560px";
// Panel.Body already pads, scrolls and glows; all this adds is the query
// container, so the content grid reflows on the body's own width rather than
// the viewport's (a container cannot query itself, hence the wrapper).
const Body = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  container-type: inline-size;
`;

// Holds the dial + list + chart. Stacked (dial/list, then chart below) when
// narrow; side-by-side (list left, chart right) past WIDE_AT. `min-height: 100%`
// lets the chart's flex-grow claim any spare vertical space in the tile.
const ContentGrid = styled.div`
  flex: 1;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-12);

  @container (min-width: ${WIDE_AT}) {
    flex-direction: row;
    align-items: stretch;
  }
`;

const LeftCol = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
  min-width: 0;

  @container (min-width: ${WIDE_AT}) {
    /* fixed-ish left column; the chart takes the rest of the width */
    flex: 0 1 340px;
  }
`;

const RouteSelect = styled(Select)`
  width: auto;
  min-width: 8rem;
`;

const NowRow = styled.div`
  display: flex;
  gap: var(--space-16);
  align-items: center;
`;

// The chart box grows to fill whatever space the tile/column gives it, down to
// a sensible minimum height. The SVG scales to fit (preserveAspectRatio meet),
// so the whole diagram: axes, legend and all: stays visible and undistorted.
const MapBox = styled.div`
  flex: 1 1 auto;
  min-height: 220px;
  min-width: 0;

  @container (min-width: ${WIDE_AT}) {
    /* beside the list it fills the row's full height */
    min-height: 0;
  }
`;

const MapSvg = styled.svg`
  width: 100%;
  height: 100%;
  display: block;
`;

const PhaseDialSvg = styled.svg`
  width: 96px;
  height: 96px;
  flex-shrink: 0;
`;

const NowFacts = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-4);
  min-width: 0;
`;

const NowLabel = styled.span`
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  text-transform: uppercase;
  letter-spacing: 0.08em;
`;

const NowValue = styled.span`
  color: var(--color-text-primary);
  font-size: var(--font-size-lg);
  font-variant-numeric: tabular-nums;
`;

const Muted = styled.span`
  color: var(--color-text-dim);
  font-size: var(--font-size-base);
`;

const ListWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`;

const ListTitle = styled.div`
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  text-transform: uppercase;
  letter-spacing: 0.08em;
`;

const BudgetReadout = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-2);
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
`;

const ReachTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
`;

const ReachTh = styled.th`
  text-align: left;
  padding: var(--space-2) var(--space-4);
  color: var(--color-text-muted);
  font-weight: normal;
  font-size: var(--font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border-bottom: 1px solid var(--color-border-subtle);

  &:not(:first-child) {
    text-align: right;
  }
`;

const ReachTd = styled.td`
  padding: var(--space-2) var(--space-4);
  border-bottom: 1px solid var(--color-border-subtle);
  white-space: nowrap;
`;

const ReachTdNum = styled(ReachTd)`
  text-align: right;
  font-variant-numeric: tabular-nums;
`;

const ReachFooter = styled.div`
  color: var(--color-text-dim);
  font-size: var(--font-size-xs);
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
`;

const ListItem = styled.li`
  display: flex;
  flex-direction: column;
`;

const WindowRow = styled.button<{ $selected: boolean }>`
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: var(--space-12);
  align-items: center;
  width: 100%;
  text-align: left;
  padding: var(--space-8) ${TEXT_PAD};
  background: ${({ $selected }) =>
    $selected ? "var(--color-surface-raised)" : "transparent"};
  border: 1px solid
    ${({ $selected }) =>
      $selected ? "var(--color-accent-fg)" : "var(--color-border-subtle)"};
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font-size: var(--font-size-base);
  font-variant-numeric: tabular-nums;
  cursor: pointer;

  &:hover {
    border-color: var(--color-border-strong);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const ColWait = styled.span`
  color: var(--color-text-primary);
`;

const ColDv = styled.span`
  color: var(--color-text-muted);
`;

const ColTof = styled.span`
  color: var(--color-text-dim);
`;

const Expander = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-8) ${TEXT_PAD} var(--space-4);
`;

const ExpRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: var(--space-12);
`;

const ExpLabel = styled.span`
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
`;

const ExpValue = styled.span`
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
`;

// The chart column: grows to fill free space (flex) with a minimum height when
// stacked; fills the row height when beside the list.
const PorkchopWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
  flex: 1 1 auto;
  min-height: 260px;

  @container (min-width: ${WIDE_AT}) {
    min-height: 0;
  }
`;

const PorkchopTitle = styled.div`
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
`;

const Inspector = styled.div`
  font-size: var(--font-size-sm);
  color: var(--color-text-dim);
  font-variant-numeric: tabular-nums;
  min-height: 1.2em;
`;
