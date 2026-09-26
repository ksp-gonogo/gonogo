import type { ActionDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  type PorkchopCell,
  registerComponent,
  type TransferSolution,
  useActionInput,
} from "@ksp-gonogo/core";
import {
  bodyAtIndex,
  CELESTIAL_FACTS,
  type CelestialBody,
  DELTA_V_BUDGET,
  useProcessor,
  useViewUt,
} from "@ksp-gonogo/sitrep-client";
import {
  stillTrue,
  TargetKind,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { Placeholder } from "@ksp-gonogo/ui";
import {
  Badge,
  Button,
  FieldLabel,
  kspCalendar,
  kspYearDays,
  NULL_DISPLAY,
  Panel,
  Section,
  Select,
  type Severity,
  Text,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import styled from "styled-components";
import { useAlarmCreator } from "../shared/AlarmsLauncher";
import { magnitudeOf, magnitudeOr } from "../shared/magnitude";
import {
  buildTransferPorkchop,
  computeTransfer,
  porkchopAxes,
  porkchopGridQuantum,
  quantiseGridUt,
  type ReachEntry,
  type ReachVerdict,
  reachEntries,
  reachVerdict,
  type TransferWindowEntry,
  transferDestinations,
  upcomingWindows,
} from "./transferData";
import { useBodyStatePropagators } from "./useBodyStatePropagators";

const topics = defineTopicManifest({
  channels: ["system.bodies", "vessel.orbit", "target.available", "dv.summary"],
});

/** Stable empty catalogue: `useProcessor` answers undefined before the first frame. */
const NO_BODIES: CelestialBody[] = [];

/**
 * Transfer Window: departure planning derived client-side from the body
 * elements on `system.bodies`. Three linked instruments: the phase DIAL, the
 * WINDOWS LIST (select a row to focus the chart on it), and the PORKCHOP Δv
 * surface for the selected window.
 */

const WINDOW_COUNT = 5;

const VERDICT_LABEL: Record<ReachVerdict, string> = {
  go: "GO",
  "one-way": "ONE WAY",
  marginal: "MARGINAL",
  no: "NO",
};

// `one-way` is a WARNING, not a failure: a flyby or an impactor is a real mission. `marginal` is the coplanar model declining to commit.
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
  /** Δv held back from the reach verdicts (m/s), e.g. a lander's descent budget. Default 0. */
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

const STATUS_LABEL: Record<string, string> = {
  go: "IDEAL",
  soon: "NEAR",
  off: "FAR",
};

// Being far from a window is "not yet", not an alarm, so FAR carries no severity.
const STATUS_SEVERITY: Record<string, Severity | undefined> = {
  go: "nominal",
  soon: "warning",
  off: undefined,
};

// Days and years are Kerbin's, the calendar the game's own map view uses.
const fmtDays = (sec: number): string =>
  `${Math.round(sec / kspCalendar().day)} d`;

const fmtCountdown = (sec: number): string => {
  const d = sec / kspCalendar().day;
  if (d < 1) return "now";
  if (d < 1000) return `in ${Math.round(d)} d`;
  return `in ${(d / kspYearDays()).toFixed(1)} y`;
};

/** The catalogue's own name when the save sent one, its index otherwise, never a fabricated name. */
function bodyLabel(body: CelestialBody): string {
  return body.name ?? `Body ${body.index}`;
}

function TransferWindowComponent({
  config,
}: ComponentProps<TransferWindowConfig>) {
  const showPorkchop = config?.showPorkchop ?? true;
  const leadSeconds = (config?.leadHours ?? 6) * 3600;
  const reserveDeltaV = config?.reserveDeltaV ?? 0;

  /**
   * The parking orbit's reference body and elements are facts that only events
   * move, so the last ones received still describe the orbit. Nothing this
   * widget judges rests on them (the dial, badge and countdowns ride the body
   * catalogue at view time); they set only the ejection Δv, which
   * `orbitNotCurrent` dates rather than blanking the board.
   */
  const orbitReading = topics.useTelemetry("vessel.orbit");
  // The observation overlaid with what the conic moved; a `ReckonableReading` cannot go through `stillTrue`.
  const observedOrbit =
    orbitReading.state === "observed" || orbitReading.state === "stale"
      ? orbitReading.value
      : undefined;
  const orbit =
    observedOrbit !== undefined && orbitReading.reckoning.status === "available"
      ? { ...observedOrbit, ...orbitReading.reckoning.value }
      : observedOrbit;
  const orbitNotCurrent = orbitReading.state === "stale";
  // "Not in an orbit" and "no orbit has reached us yet" are different sentences.
  const orbitConfirmedAbsent = orbitReading.state === "absent";
  // A catalogue only changes when the game does, so a held one is still the catalogue.
  const factsReading = useProcessor(CELESTIAL_FACTS);
  const facts =
    factsReading?.state === "observed" || factsReading?.state === "stale"
      ? factsReading.value
      : undefined;
  const bodies = facts?.bodies ?? NO_BODIES;
  // Through the canonical funnel, which coalesces a non-finite reading to 0 rather than passing NaN into the porkchop.
  const nowUt = magnitudeOr(useViewUt(), 0);

  /**
   * The vehicle's Δv budget: a description, so a dated one is captioned, never
   * withheld. An old budget can only OVER-state reach (it falls by burning), so
   * `budgetNotCurrent` hollows the verdict pips: "GO, six minutes ago" must not
   * read as "GO".
   */
  const budgetReading = useProcessor(DELTA_V_BUDGET);
  const budget =
    budgetReading?.state === "observed" || budgetReading?.state === "stale"
      ? budgetReading.value
      : undefined;
  const budgetDeltaV = magnitudeOf(budget?.totalVac);
  const budgetNotCurrent = budget?.budget.state === "stale";
  /** The stock Δv sim has no figure for this craft, as opposed to none having arrived. */
  const budgetConfirmedAbsent = budget?.budget.confirmedAbsent ?? false;
  // Stays in the algebra so `Unit` renders the duration.
  const budgetAge =
    budget?.budget.ageSec === undefined
      ? null
      : value("s", budget.budget.ageSec);
  const createAlarm = useAlarmCreator<TimeTrigger>();

  const origin = bodyAtIndex(facts, orbit?.referenceBodyIndex);

  const dests = useMemo(
    () => (origin ? transferDestinations(origin, bodies) : []),
    [origin, bodies],
  );

  /**
   * Seeds the destination: an explicit pick wins, then the targeted body, then
   * the first sibling. The roster is a fact, so a held list still seeds it, and
   * a confirmed empty roster means nothing is targeted like a missing one does.
   */
  const targetList = stillTrue(
    topics.useTelemetry("target.available"),
    undefined,
  );
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

  // Periapsis radius, `a(1 - e)`, kept in the algebra.
  const parkingRadius =
    orbit?.sma != null && orbit?.ecc != null
      ? orbit.sma.times(value("1", 1).minus(orbit.ecc)).magnitude
      : null;

  const solution: TransferSolution | null = useMemo(
    () =>
      origin && dest && parkingRadius != null && Number.isFinite(parkingRadius)
        ? computeTransfer({ origin, dest, bodies, parkingRadius, nowUt })
        : null,
    [origin, dest, bodies, parkingRadius, nowUt],
  );

  /**
   * What the porkchop's inputs are rounded to before they reach a memo: the
   * grid is 1,024 Lambert solves and `useViewUt` notifies every frame. The
   * quantum scales with the Hohmann transfer time the axes are drawn in, so it
   * holds at any warp.
   */
  const gridQuantum = solution
    ? porkchopGridQuantum(solution.transferTimeSec)
    : null;
  const quantise = (ut: number): number => quantiseGridUt(ut, gridQuantum);
  // `departureUt` is re-derived every frame and jitters in the low bits, so it is quantised too.
  const gridNowUt = quantise(nowUt);
  const gridCenterDepUt =
    solution?.departureUt === undefined
      ? undefined
      : quantise(solution.departureUt);

  // The base porkchop is windowed on the next window's ideal departure. Its axes come first so body states can be asked of the game; the grid uses the client's own conic until they arrive.
  const baseAxes = useMemo(
    () =>
      origin && dest
        ? porkchopAxes({
            origin,
            dest,
            bodies,
            nowUt: gridNowUt,
            centerDepUt: gridCenterDepUt,
          })
        : null,
    [origin, dest, bodies, gridNowUt, gridCenterDepUt],
  );
  const baseStates = useBodyStatePropagators(
    origin ?? null,
    dest ?? null,
    bodies,
    baseAxes,
  );

  const basePorkchop = useMemo(
    () =>
      origin && dest
        ? buildTransferPorkchop({
            origin,
            dest,
            bodies,
            nowUt: gridNowUt,
            centerDepUt: gridCenterDepUt,
            propagateOrigin: baseStates?.propagateOrigin,
            propagateDest: baseStates?.propagateDest,
          })
        : null,
    [origin, dest, bodies, gridNowUt, gridCenterDepUt, baseStates],
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

  /**
   * The reach list's recompute quantum: one day of the game's own calendar,
   * the finest change its Window column can display. Only `waitSeconds` moves
   * with the clock. This is acceptable only while the exact, unquantised
   * countdown in the windows list exists; without it a day's lag would tell the
   * operator "in 1 d" about an open window.
   */
  const reachRecomputeUt = kspCalendar().day;
  const reachUtBucket = Math.floor(nowUt / reachRecomputeUt);

  // Keyed on a coarse view time so a list of closed-form solves stays off the per-frame path.
  const reach = useMemo(
    () =>
      origin && parkingRadius != null && Number.isFinite(parkingRadius)
        ? reachEntries({
            origin,
            bodies,
            parkingRadius,
            nowUt: reachUtBucket * reachRecomputeUt,
          })
        : [],
    [origin, bodies, parkingRadius, reachUtBucket, reachRecomputeUt],
  );

  // Later windows rebuild centred on their own departure. Depends on the two quantised numbers, not on `selected`, which is a fresh object every rebuild.
  const focusedIsBase = !selected || selected.index === 0;
  const focusedCenterDepUt = selected
    ? quantise(selected.departureUt)
    : undefined;
  const focusedAxes = useMemo(() => {
    if (!origin || !dest || focusedIsBase || focusedCenterDepUt === undefined) {
      return null;
    }
    return porkchopAxes({
      origin,
      dest,
      bodies,
      nowUt: gridNowUt,
      centerDepUt: focusedCenterDepUt,
    });
  }, [origin, dest, bodies, gridNowUt, focusedIsBase, focusedCenterDepUt]);
  const focusedStates = useBodyStatePropagators(
    origin ?? null,
    dest ?? null,
    bodies,
    focusedAxes,
  );

  const focusedPorkchop = useMemo(() => {
    if (!origin || !dest || focusedIsBase || focusedCenterDepUt === undefined) {
      return basePorkchop;
    }
    return buildTransferPorkchop({
      origin,
      dest,
      bodies,
      nowUt: gridNowUt,
      centerDepUt: focusedCenterDepUt,
      propagateOrigin: focusedStates?.propagateOrigin,
      propagateDest: focusedStates?.propagateDest,
    });
  }, [
    origin,
    dest,
    bodies,
    gridNowUt,
    focusedIsBase,
    focusedCenterDepUt,
    focusedStates,
    basePorkchop,
  ]);

  if (!orbit || !origin) {
    return (
      <Panel
        panelTitle="Transfer Window"
        sections={
          <Section>
            <Placeholder>
              {orbitConfirmedAbsent
                ? "No parking orbit: the vessel reports it is not in one."
                : "Waiting for vessel orbit..."}
            </Placeholder>
          </Section>
        }
      />
    );
  }
  if (dests.length === 0 || !dest) {
    return (
      <Panel
        panelTitle="Transfer Window"
        sections={
          <Section>
            <Placeholder>
              No transfer destinations. {origin.name ?? "The origin body"} has
              no sibling bodies to transfer to.
            </Placeholder>
          </Section>
        }
      />
    );
  }

  return (
    <Panel
      panelTitle="Transfer Window"
      sections={
        <Section>
          <Body>
            {orbitNotCurrent && (
              // Dated, and says which half of the panel it applies to: the dial and window times are still current.
              <Text tone="warn" size="xs" role="status" aria-live="polite">
                Parking orbit no longer current: Δv is from the last known
                elements. Phase and window times stay live.
              </Text>
            )}
            <ReachList
              entries={reach}
              originName={origin.name ?? "here"}
              budgetDeltaV={budgetDeltaV}
              reserveDeltaV={reserveDeltaV}
              budgetNotCurrent={budgetNotCurrent}
              selectedIndex={dest.index}
              onSelect={setDestIndex}
              budgetAge={budgetAge}
              budgetConfirmedAbsent={budgetConfirmedAbsent}
            />
            {/* Container-queried on the body's own width. Renders whether or not a transfer solves, so the destination select stays reachable. */}
            <ContentGrid>
              <LeftCol>
                {solution ? (
                  <NowRow>
                    <PhaseDial solution={solution} />
                    <NowFacts>
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
                      {/* Only the verdict is announced: the phase moves every frame. */}
                      <Badge severity={STATUS_SEVERITY[solution.status]} live>
                        {STATUS_LABEL[solution.status]}
                      </Badge>
                    </NowFacts>
                  </NowRow>
                ) : (
                  <Placeholder>Waiting for orbital elements...</Placeholder>
                )}

                <WindowsList
                  windows={windows}
                  selectedIndex={selIdx}
                  onSelect={setSelectedWindow}
                  destPicker={
                    // Label and select are direct children of SectionHead so the select's narrow-width rule sizes correctly; the heading IS the control's label.
                    <>
                      <FieldLabel htmlFor="transfer-dest">
                        <ListTitle as="span">Windows to</ListTitle>
                      </FieldLabel>
                      <RouteSelect
                        id="transfer-dest"
                        value={dest.index}
                        onChange={(e) => setDestIndex(Number(e.target.value))}
                      >
                        {dests.map((d) => (
                          <option key={d.index} value={d.index}>
                            {bodyLabel(d)}
                          </option>
                        ))}
                      </RouteSelect>
                    </>
                  }
                  createAlarm={
                    createAlarm
                      ? (w) =>
                          createAlarm({
                            name: `Transfer: ${bodyLabel(origin)} to ${bodyLabel(dest)}`,
                            trigger: {
                              kind: "time",
                              ut: w.departureUt,
                              leadSeconds,
                            },
                          })
                      : null
                  }
                />
              </LeftCol>

              {showPorkchop && focusedPorkchop && (
                <Porkchop grid={focusedPorkchop} nowUt={nowUt} />
              )}
            </ContentGrid>
          </Body>
        </Section>
      }
    />
  );
}

function WindowsList({
  windows,
  selectedIndex,
  onSelect,
  destPicker,
  createAlarm,
}: {
  windows: TransferWindowEntry[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  /** The destination select, on this section's heading line: it scopes THIS list. */
  destPicker: ReactNode;
  createAlarm: ((w: TransferWindowEntry) => void) | null;
}) {
  return (
    <ListWrap>
      <SectionHead>{destPicker}</SectionHead>
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
 * The reach list: which destinations this craft can get to on its current
 * budget, cheapest first. The verdict column is DROPPED when there is no budget:
 * an empty column invites a verdict nobody can supply.
 */
function ReachList({
  entries,
  originName,
  budgetDeltaV,
  reserveDeltaV,
  budgetNotCurrent,
  selectedIndex,
  onSelect,
  budgetAge,
  budgetConfirmedAbsent,
}: {
  entries: ReachEntry[];
  originName: string;
  budgetDeltaV: number | null;
  reserveDeltaV: number;
  budgetNotCurrent: boolean;
  /** Body index of the destination the windows list is currently scoped to. */
  selectedIndex: number;
  onSelect: (bodyIndex: number) => void;
  /** How long ago the budget was observed, for the dated caption. */
  budgetAge: Value<"s"> | null;
  /** The stock sim reports no figure for this craft, as opposed to none arriving. */
  budgetConfirmedAbsent: boolean;
}) {
  if (entries.length === 0) return null;
  const haveBudget = budgetDeltaV != null;

  return (
    <ListWrap>
      <ReachHead>
        <ListTitle id="reach-caption">Reach from {originName}</ListTitle>
        {/* The budget sits directly above the verdicts it produced, the funds-readout rule; `vac` stays because the ISP assumption is part of the figure. */}
        {budgetDeltaV != null && (
          <BudgetReadout>
            <Muted>Budget</Muted>{" "}
            <Unit value={value("m/s", budgetDeltaV)} decimals={0} /> vac
            {reserveDeltaV > 0 && (
              <Muted>
                {" reserve "}
                <Unit value={value("m/s", reserveDeltaV)} decimals={0} />
              </Muted>
            )}
          </BudgetReadout>
        )}
      </ReachHead>
      {/* Three distinct budget sentences: a dated figure still plans, confirmed-absent means the stock sim has nothing, and silence means not heard. */}
      {budgetNotCurrent && budgetDeltaV != null && (
        <Text tone="warn" size="xs" role="status" aria-live="polite">
          Budget last heard{" "}
          {budgetAge ? <Unit value={budgetAge} decimals={0} /> : "some time"}{" "}
          ago. Δv only falls as you burn, so reach here can only be optimistic.
        </Text>
      )}
      {budgetConfirmedAbsent && (
        <Text tone="warn" size="xs" role="status" aria-live="polite">
          No Δv figure for this craft: the stock simulation reports none, so
          costs are shown without a verdict.
        </Text>
      )}
      <ReachScroll>
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
                    <ReachPick
                      type="button"
                      $selected={entry.body.index === selectedIndex}
                      aria-pressed={entry.body.index === selectedIndex}
                      onClick={() => onSelect(entry.body.index)}
                    >
                      {bodyLabel(entry.body)}
                    </ReachPick>
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
                        // A stale budget can only over-state reach, so dated verdicts do not wear the live GO colour.
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
      </ReachScroll>
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

// Continuous Δv to colour ramp, violet (cheap optimum) through to red (worst), with no discrete banding. `t` is the capped, normalised Δv in [0,1].
const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
const rampColor = (t: number): string =>
  `hsl(${(258 * (1 - clamp01(t))).toFixed(1)}, 66%, 48%)`;

// Plot geometry (SVG user units); margins leave room for the ticks and the Δv legend.
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
  // Capped near the optimum (never past the real max) so the bullseye keeps contour resolution; outliers saturate the top band.
  const scaleMax = Math.min(max, min * 1.8);
  const scaleSpan = scaleMax - min || 1;
  const capped = scaleMax < max;
  const cellW = PLOT_W / cols;
  const cellH = PLOT_H / rows;
  const days = (sec: number) => Math.round(sec / kspCalendar().day);
  const dayOffset = (ut: number) => days(ut - nowUt);
  const kms = (ms: number) => (ms / 1000).toFixed(1);

  // Departure increases left to right; arrival bottom to top, like a canonical porkchop.
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
            {/* Legend ramp: worst at top, cheap at bottom, matching the plot's scale. */}
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={rampColor(1)} />
              <stop offset="25%" stopColor={rampColor(0.75)} />
              <stop offset="50%" stopColor={rampColor(0.5)} />
              <stop offset="75%" stopColor={rampColor(0.25)} />
              <stop offset="100%" stopColor={rampColor(0)} />
            </linearGradient>
          </defs>
          {/* The off-scale colour fills the plot and only lower-Δv cells paint on top; no-solution cells stay background. */}
          <rect
            x={M.left}
            y={M.top}
            width={PLOT_W}
            height={PLOT_H}
            fill={rampColor(1)}
            pointerEvents="none"
          />
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
  channels: topics.channels,
  defaultConfig: { showPorkchop: true, leadHours: 6, reserveDeltaV: 0 },
  actions: transferWindowActions,
  pushable: true,
  requires: ["flight"],
});

export { TransferWindowComponent };

// Body inline-size at which the chart moves from under the list to beside it.
const WIDE_AT = "560px";

// Below this body width the destination select takes its own line: at 5 and 6 units wide "WINDOWS TO" plus a select does not fit.
const NARROW_HEAD_AT = "256px";
// The query container, so the content grid reflows on the body's own width (a container cannot query itself).
const Body = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  container-type: inline-size;
`;

const ContentGrid = styled.div`
  flex: 1;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);

  @container (min-width: ${WIDE_AT}) {
    flex-direction: row;
    align-items: stretch;
  }
`;

const LeftCol = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-section);
  min-width: 0;

  @container (min-width: ${WIDE_AT}) {
    flex: 0 1 340px;
  }
`;

const RouteSelect = styled(Select)`
  width: auto;
  /* Shrinkable, so the heading fits a narrow panel; it cannot go below its own content. */
  min-width: 0;
  max-width: 100%;

  /* Too narrow to share a line with the label, so the select takes its own. */
  @container (max-width: ${NARROW_HEAD_AT}) {
    flex: 1 1 100%;
  }
`;

const NowRow = styled.div`
  display: flex;
  gap: var(--gap-section);
  align-items: center;
`;

// Grows to fill the tile down to a minimum height; the SVG scales to fit undistorted.
const MapBox = styled.div`
  flex: 1 1 auto;
  min-height: 220px;
  min-width: 0;

  @container (min-width: ${WIDE_AT}) {
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
  gap: var(--gap-related);
  min-width: 0;
`;

const NowLabel = styled.span`
  color: var(--color-text-muted);
  font-size: var(--font-size-caption);
  text-transform: uppercase;
  letter-spacing: 0.08em;
`;

const NowValue = styled.span`
  color: var(--color-text-primary);
  font-size: var(--font-size-figure);
  font-variant-numeric: tabular-nums;
`;

const Muted = styled.span`
  color: var(--color-text-dim);
  font-size: var(--font-size-compact);
`;

const ListWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const ListTitle = styled.div`
  color: var(--color-text-muted);
  font-size: var(--font-size-caption);
  text-transform: uppercase;
  letter-spacing: 0.08em;
`;

const SectionHead = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
  /* The heading and its select are one phrase, so they wrap together. */
  flex-wrap: wrap;
  min-width: 0;
`;

/**
 * The destination cell as a `<button>`, so the row stays a row for a screen
 * reader and picking is keyboard-reachable. `aria-pressed` carries the scope,
 * since the visual cue is a colour.
 */
const ReachPick = styled.button<{ $selected: boolean }>`
  appearance: none;
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  cursor: pointer;
  text-align: left;
  color: ${(p) => (p.$selected ? "var(--color-accent-fg)" : "inherit")};

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const ReachHead = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--gap-related);
  flex-wrap: wrap;
`;

const BudgetReadout = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: var(--gap-related);
  font-size: var(--font-size-compact);
  font-variant-numeric: tabular-nums;
`;

// Scrolls rather than clipping at narrow placements, so no column is lost silently; `min-width` keeps columns from collapsing.
const ReachScroll = styled.div`
  overflow-x: auto;
  max-width: 100%;
`;

const ReachTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-compact);
`;

const ReachTh = styled.th`
  text-align: left;
  /* Shared with ReachTd below, which has to match it. */
  padding: var(--inset-reach-cell);
  color: var(--color-text-muted);
  font-weight: normal;
  font-size: var(--font-size-caption);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border-bottom: 1px solid var(--color-border-subtle);

  &:not(:first-child) {
    text-align: right;
  }
`;

const ReachTd = styled.td`
  /* Matches ReachTh above. */
  padding: var(--inset-reach-cell);
  border-bottom: 1px solid var(--color-border-subtle);
  white-space: nowrap;
`;

const ReachTdNum = styled(ReachTd)`
  text-align: right;
  font-variant-numeric: tabular-nums;
`;

const ReachFooter = styled.div`
  color: var(--color-text-dim);
  font-size: var(--font-size-compact);
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const ListItem = styled.li`
  display: flex;
  flex-direction: column;
`;

const WindowRow = styled.button<{ $selected: boolean }>`
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: var(--gap-section);
  align-items: center;
  width: 100%;
  text-align: left;
  padding: var(--inset-window-row);
  background: ${({ $selected }) =>
    $selected ? "var(--color-surface-raised)" : "transparent"};
  border: 1px solid
    ${({ $selected }) =>
      $selected ? "var(--color-accent-fg)" : "var(--color-border-subtle)"};
  border-radius: var(--radius-regular);
  color: var(--color-text-primary);
  font-size: var(--font-size-compact);
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
  gap: var(--gap-related);
  padding: var(--inset-window-expander);
`;

const ExpRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: var(--gap-section);
`;

const ExpLabel = styled.span`
  color: var(--color-text-muted);
  font-size: var(--font-size-compact);
`;

const ExpValue = styled.span`
  color: var(--color-text-primary);
  font-size: var(--font-size-value);
  font-variant-numeric: tabular-nums;
`;

const PorkchopWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  min-width: 0;
  flex: 1 1 auto;
  min-height: 260px;

  @container (min-width: ${WIDE_AT}) {
    min-height: 0;
  }
`;

const PorkchopTitle = styled.div`
  color: var(--color-text-muted);
  font-size: var(--font-size-value);
`;

const Inspector = styled.div`
  font-size: var(--font-size-compact);
  color: var(--color-text-dim);
  font-variant-numeric: tabular-nums;
  min-height: 1.2em;
`;
