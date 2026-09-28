import type { ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
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
import { stillTrue, TargetKind, value } from "@ksp-gonogo/sitrep-sdk";
import { Placeholder } from "@ksp-gonogo/ui";
import {
  Badge,
  FieldLabel,
  kspCalendar,
  Panel,
  Section,
  Unit,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useMemo, useState } from "react";
import { useAlarmCreator } from "../shared/AlarmsLauncher";
import { magnitudeOf, magnitudeOr } from "../shared/magnitude";
import {
  type TimeTrigger,
  type TransferWindowActions,
  type TransferWindowConfig,
  transferWindowActions,
} from "./config";
import type { HeldSince } from "./heldFigure";
import { bodyLabel, STATUS_LABEL, STATUS_SEVERITY } from "./labels";
import { PhaseDial } from "./PhaseDial";
import { Porkchop } from "./Porkchop";
import { ReachList } from "./ReachList";
import {
  Body,
  ContentGrid,
  LeftCol,
  ListTitle,
  Muted,
  NowFacts,
  NowLabel,
  NowRow,
  NowValue,
  RouteSelect,
} from "./styles";
import {
  computeTransfer,
  porkchopGridQuantum,
  quantiseGridUt,
  reachEntries,
  transferDestinations,
  upcomingWindows,
} from "./transferData";
import { usePorkchop } from "./usePorkchop";
import { WindowsList } from "./WindowsList";

export type { TransferWindowActions } from "./config";

const topics = defineTopicManifest({
  channels: ["system.bodies", "vessel.orbit", "target.available", "dv.summary"],
});

/** Stable empty catalogue: `useProcessor` answers undefined before the first frame. */
const NO_BODIES: CelestialBody[] = [];

const WINDOW_COUNT = 5;

/**
 * Transfer Window: departure planning derived client-side from the body
 * elements on `system.bodies`. Three linked instruments: the phase DIAL, the
 * WINDOWS LIST (select a row to focus the chart on it), and the PORKCHOP Δv
 * surface for the selected window.
 */
function TransferWindowComponent({
  config,
}: ComponentProps<TransferWindowConfig>) {
  const showPorkchop = config?.showPorkchop ?? true;
  const leadSeconds = (config?.leadHours ?? 6) * 3600;
  const reserveDeltaV = config?.reserveDeltaV ?? 0;

  // Only events move the parking orbit, so a held one still describes it; only its Δv figures rest on it, and they draw held.
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
  const orbitHeldSince: HeldSince =
    orbitReading.state === "stale"
      ? { asOfUt: orbitReading.asOfUt, grade: orbitReading.grade }
      : null;
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
   * The vehicle's Δv budget: a description, so a held one is still drawn, never
   * withheld. An old budget can only OVER-state reach (it falls by burning), so
   * `budgetHeld` hollows the verdict pips: a held GO must not read as GO.
   */
  const budgetReading = useProcessor(DELTA_V_BUDGET);
  const budget =
    budgetReading?.state === "observed" || budgetReading?.state === "stale"
      ? budgetReading.value
      : undefined;
  const budgetDeltaV = magnitudeOf(budget?.totalVac);
  const budgetHeld = budget?.budget.state === "stale";
  const budgetHeldSince: HeldSince = budgetHeld
    ? { asOfUt: budget?.budget.asOfUt }
    : null;
  const budgetConfirmedAbsent = budget?.budget.confirmedAbsent ?? false;
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

  // The base porkchop is windowed on the next window's ideal departure.
  const basePorkchop = usePorkchop({
    origin,
    dest,
    bodies,
    nowUt: gridNowUt,
    centerDepUt: gridCenterDepUt,
  });

  const windows = useMemo(
    () =>
      solution && basePorkchop
        ? upcomingWindows(solution, basePorkchop, nowUt, WINDOW_COUNT)
        : [],
    [solution, basePorkchop, nowUt],
  );

  const [selectedWindow, setSelectedWindow] = useState(0);
  const destKey = dest?.index ?? -1;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on destination change, not on selection.
  useEffect(() => setSelectedWindow(0), [destKey]);
  const selIdx = Math.min(selectedWindow, Math.max(0, windows.length - 1));
  const selected = windows[selIdx] ?? null;

  // One game day, the finest step the reach Window column shows; the windows list keeps the exact countdown.
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
  const focusedOwnGrid = !focusedIsBase && focusedCenterDepUt !== undefined;
  const focusedGrid = usePorkchop({
    origin,
    dest,
    bodies,
    nowUt: gridNowUt,
    centerDepUt: focusedCenterDepUt,
    enabled: focusedOwnGrid,
  });
  const focusedPorkchop =
    origin && dest && focusedOwnGrid ? focusedGrid : basePorkchop;

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
            <ReachList
              entries={reach}
              originName={origin.name ?? "here"}
              budgetDeltaV={budgetDeltaV}
              reserveDeltaV={reserveDeltaV}
              budgetHeld={budgetHeld}
              selectedIndex={dest.index}
              onSelect={setDestIndex}
              budgetHeldSince={budgetHeldSince}
              budgetConfirmedAbsent={budgetConfirmedAbsent}
              orbitHeldSince={orbitHeldSince}
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
                  orbitHeldSince={orbitHeldSince}
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
