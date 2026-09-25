import type { ActionDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  registerComponent,
  useActionInput,
  useOrbitSolve,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  type OrbitTrajectory,
  useOrbitTrajectory,
  useStream,
} from "@ksp-gonogo/sitrep-client";
import {
  apsidesExist,
  type ControlFrame,
  controlFrameLabel,
  frameCaveat,
  type ReckoningDecline,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Countdown,
  Grid,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  Section,
  Stack,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { OrbitDiagram } from "../shared/OrbitDiagram";
import { TrajectoryFrameCaption } from "../shared/trajectoryFrame";
import { TrajectoryWithheldNote } from "../shared/trajectoryWithheld";
import { useBodyName, useParentBodyIndex } from "../shared/useBodyName";
import { useIsOrbiting } from "../shared/useIsOrbiting";
import { useStreamBody } from "../shared/useStreamBody";

const topics = defineTopicManifest({
  channels: ["vessel.orbit", "vessel.identity", "system.bodies"],
  fields: [
    "vessel.orbit.sma",
    "vessel.orbit.ecc",
    "vessel.orbit.inc",
    "vessel.orbit.argPe",
    "vessel.orbit.referenceBodyIndex",
    "vessel.identity.parentBodyIndex",
  ],
});

interface CurrentOrbitConfig {
  /** Show the mini SVG orbit diagram. Default: true. */
  showDiagram?: boolean;
}

const currentOrbitActions = [
  {
    id: "toggleDiagram",
    label: "Toggle Diagram",
    accepts: ["button"],
    description: "Show or hide the mini orbit diagram.",
  },
] as const satisfies readonly ActionDefinition[];

export type CurrentOrbitActions = typeof currentOrbitActions;

function CurrentOrbitComponent({
  config,
  onConfigChange,
  w,
  h,
}: Readonly<ComponentProps<CurrentOrbitConfig>>) {
  const showDiagram = config?.showDiagram ?? true;

  useActionInput<CurrentOrbitActions>({
    toggleDiagram: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      const next = !showDiagram;
      onConfigChange?.({ ...config, showDiagram: next });
      return { diagramVisible: next };
    },
  });

  /*
   * Every figure below is solved from the craft's own elements for the instant
   * being viewed, and the whole solve is absent together whenever the conic
   * that authorises it has withdrawn. That is one answer for the whole group
   * rather than six, and it is the same answer the reading-backed elements
   * further down already give: an apsis, a countdown and a period are claims
   * about a coast, and there is no coast to make them about.
   *
   * `?? undefined` on each: the solve says `null` for a quantity the orbit
   * does not have (no apoapsis on a hyperbolic trajectory) and `undefined`
   * while the reference body's radius has not resolved. Both are an absence
   * this column draws the same way, so they are folded once here instead of
   * being re-tested at each of the five readouts.
   */
  const solve = useOrbitSolve();
  const apoapsisARaw = solve?.apoapsisAlt ?? undefined;
  const periapsisARaw = solve?.periapsisAlt ?? undefined;
  const apoapsisR = solve?.apoapsisRadius ?? null;
  const periapsisR = solve?.periapsisRadius ?? null;
  const timeToApRaw = solve?.timeToAp ?? undefined;
  const timeToPeRaw = solve?.timeToPe ?? undefined;

  /**
   * What the operator's own view frame does to these two numbers.
   *
   * An apsis is defined against a centre, and the frames defined by a pair of
   * bodies have none; a frame defined against the target has none whatever kind
   * it carries. In those an apoapsis is not merely unmeasured, it does not
   * exist, and that is a different thing to tell someone than an em-dash, which
   * this widget already uses to mean "absent on this trajectory".
   */
  const frameReading = useStream<ControlFrame>("system.frame");
  // The selected frame is a setting, which a quiet link does not change.
  const controlFrame =
    frameReading.state === "observed" || frameReading.state === "stale"
      ? frameReading.value
      : undefined;
  const apsides = apsidesExist(controlFrame);
  const noApsidesHere = apsides === "invalid";
  // Every read rides the SDK stream directly, no legacy `useTelemetry("data",
  // ...)` fallback:
  //   - sma/eccentricity/inclination/argPe are raw `vessel.orbit.*` elements,
  //     read off the canonical whole-`vessel.orbit` Topic.
  //   - Ap/Pe/ApR/PeR/timeToAp/timeToPe/trueAnomaly/period are the solve over
  //     those same elements at view-UT, through `useOrbitSolve`.
  //   - the two body names are indices resolved against the `system.bodies`
  //     catalogue, through `useBodyName`.
  // This widget DRAWS the orbit and the craft's place on it, which is a marker:
  // a positive claim about where it is now. So the elements come from a CURRENT
  // reading, or from a model where one is on offer, and otherwise from nothing,
  // and the diagram's own absent-value rendering takes over. Same decision as
  // MapView, SystemView and FleetComms.
  const orbitReading = useTelemetry("vessel.orbit");
  /*
   * The observation OVERLAID by whatever the conic moved, which for
   * `vessel.orbit` is the phase: `meanAnomalyAtEpoch` and `epoch`. The elements
   * beside them are constants of the orbit and no model moves them, so they
   * come from the observation either way.
   *
   * Written here rather than hidden in a helper because the spread IS the
   * judgement, as `ReckonableReading`'s own doc puts it. Picking one side or the
   * other, which this did before, gets a two-field fragment whenever the model
   * is available, and drew the eccentricity and inclination as the absence
   * placeholder.
   *
   * ## A STALE reading is only drawn when a model makes it current
   *
   * The paragraph above is the whole rule and this is the case it does not
   * obviously cover, so it is spelled out. A stale orbit with NO model draws
   * nothing: sharing an element that merely stopped arriving, as a present-tense
   * claim about where the craft is, says nothing true, and this widget is a
   * marker rather than a log.
   *
   * A stale orbit WITH a model does draw, and that is not the same act. `sma`,
   * `ecc` and `inc` are constants of the orbit rather than figures that go out
   * of date, so a conic that moves the phase makes the whole thing current: the
   * result is assembled from a constant and a model, not held from an old
   * frame.
   */
  const observedOrbit =
    orbitReading.state === "observed" || orbitReading.state === "stale"
      ? orbitReading.value
      : undefined;
  const orbit =
    observedOrbit !== undefined && orbitReading.reckoning.status === "available"
      ? { ...observedOrbit, ...orbitReading.reckoning.value }
      : orbitReading.state === "observed"
        ? orbitReading.value
        : undefined;
  const sma = orbit?.sma;
  const eccentricity = orbit?.ecc;
  const argPe = orbit?.argPe;
  const inclination = orbit?.inc;
  const trueAnomaly = solve?.trueAnomaly ?? undefined;
  /*
   * The derived READOUTS null when the orbit reading is not current, even where
   * a model would go on solving it: an apsis, a countdown and a period are read
   * as present-tense claims, and drawn unchanged down a link that has stopped
   * they leave an operator no way to tell the link has gone.
   *
   * NULL rather than a mark: a staleness presentation is earned by figures read
   * second by second, and an apoapsis is not read that way, so it falls the
   * same side as `ecc` and `inc` and the column stays consistent.
   *
   * The RADII are deliberately NOT nulled: they feed the diagram's own
   * geometry rather than a readout, and the diagram already refuses to draw a
   * curve it cannot make current.
   */
  const orbitCurrent = orbitReading.state === "observed";
  const apoapsisA = orbitCurrent ? apoapsisARaw : undefined;
  const periapsisA = orbitCurrent ? periapsisARaw : undefined;
  const timeToAp = orbitCurrent ? timeToApRaw : undefined;
  const timeToPe = orbitCurrent ? timeToPeRaw : undefined;
  const period = orbitCurrent ? (solve?.period ?? undefined) : undefined;
  /*
   * The body's NAME is a label rather than a marker, so it holds off the last
   * observation the way the subtitle beside it does: which body a craft is
   * around does not change down a link that has gone quiet.
   */
  const refBody = useBodyName(observedOrbit?.referenceBodyIndex);
  const bodyName = useBodyName(useParentBodyIndex());
  // Connectivity indicator: `o.sma` is the representative topic (its resolved
  // `vessel.orbit.sma` stream drives the badge).

  // What the mini diagram's curve IS, asked of the propagation seam rather than
  // decided here. `sma`, `ecc` and `inc` go on rendering either way: those were
  // measured at the sample instant and are true whoever computed them. The
  // apsides beside them were not measured, they are a derivation at view time
  // through the same propagation capability, so a refusal takes them with it.
  const trajectory: OrbitTrajectory | null = useOrbitTrajectory(orbit);
  const withheld =
    trajectory !== null && trajectory.shape === "withheld" ? trajectory : null;

  /*
   * Why the derived figures are dashes, when the elements arrived and the conic
   * declined to advance them. A refused TRAJECTORY already says so in its own
   * note, so this speaks only when that one is silent, and only when the solve
   * gave nothing: under physics a current reading is still solved for what
   * needs no advancing, and a state word beside a drawn apoapsis would deny it.
   */
  const declined =
    observedOrbit !== undefined &&
    withheld === null &&
    solve === null &&
    orbitReading.reckoning.status === "declined"
      ? orbitReading.reckoning.declined
      : undefined;
  const modelState = declined ? declinedState(declined) : null;

  /* Physics off the wire, presentation from the table: `useStreamBody` merges
   * the two, so `body.radius` is the running game's and `body.color` is still
   * the registry's, which no wire field replaces. */
  const body = useStreamBody(bodyName, refBody);
  const { isOrbiting } = useIsOrbiting();

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [isLandscape, setIsLandscape] = useState(false);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setIsLandscape(width > height && width >= 240);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Apoapsis is intentionally NOT required, it's `null` on a hyperbolic
  // orbit (no apoapsis exists), not an error. Periapsis is always real
  // whenever there IS a solve, so it (plus sma/eccentricity) is the true
  // "is there a curve to draw" signal. `!= null` catches both `null` and
  // `undefined`.
  const canDrawDiagram =
    sma != null && eccentricity != null && periapsisR != null;

  // Selective rendering: Ap/Pe always; supplementary rows drop bottom-up
  // as height shrinks. Diagram needs real area to be readable.
  const cols = w ?? 9;
  const rows = h ?? 18;
  const showSubtitle = rows >= 4;
  const showInclinationRow = rows >= 5;
  const showApProgressRows = rows >= 6;
  const showEccentricityRows = rows >= 8;
  // The diagram slot is gated on real area, but the axis that matters
  // differs by orientation: stacked above the values it eats height
  // (rows >= 8), but in the wide-short landscape case it sits *beside*
  // them and eats width instead. Gating purely on height locked the
  // diagram out of exactly the wide-short mode (e.g. 12×6) the flex-flip
  // was built for, leaving ~60% dead space. Allow either a tall panel
  // or a wide one.
  /* A REFUSAL opens the slot too. When the provider declines to authorise a
     curve the solve goes with it, so there is nothing to draw and, without
     this, nothing to read either: the slot would close and take the sentence
     naming the refusal with it, leaving a column of dashes and no account of
     why. The refusal is the most useful thing on the panel in that state. */
  const showDiagramSlot =
    showDiagram &&
    (canDrawDiagram || withheld !== null) &&
    cols >= 5 &&
    (rows >= 8 || cols >= 10);
  // Tiny widget: at minSize 3×4 the formatted "85.0 km" wraps to two
  // lines inside the 1fr value column. Drop the label column to 2.2em
  // and the value font to 11 px so a one-line value fits inside ~80 px
  // of content width.
  const tight = cols < 4 || rows < 5;
  // Narrow panels (3–4 cols) can't fit long values like "1000.00 Mm" or
  // "5h 15m 00s" at the 13 px tier, they clip at the panel edge. Shrink
  // the value font on any narrow column count, not just the `tight`
  // (small-on-both-axes) case, so compact (4×6) doesn't overflow either.
  const narrow = cols < 5;
  const hyperbolic = typeof eccentricity === "number" && eccentricity >= 1;

  return (
    <Panel
      panelTitle="ORBIT"
      sections={[
        <Section key="frame" full>
          {/* Reference body as an in-body caption rather than in the Panel
            subtitle slot; a plain span carries the muted caption type without
            styled-components. */}
          {showSubtitle && refBody !== undefined && (
            <span
              style={{
                fontSize: "var(--font-size-caption)",
                color: "var(--color-text-muted)",
                letterSpacing: "0.03em",
              }}
            >
              {refBody}
            </span>
          )}
          {/* Which frame the curve below is drawn in. The same points are a
            different path in every frame, so the drawing is only readable
            alongside its own frame. */}
          <TrajectoryFrameCaption
            trajectory={trajectory}
            centreBodyIndex={orbit?.referenceBodyIndex}
          />
          {modelState !== null && (
            <ReadoutCaption title={declined?.note}>{modelState}</ReadoutCaption>
          )}
          {/* The GAME's own view frame, which is a different fact from the frame
            this widget drew in above: that one is this panel's choice and nobody
            else's, this one is what the operator is looking at in the game and
            what decides whether the numbers below exist at all. Named only when
            it takes one of them away, because a frame caption on a panel whose
            readouts it does not touch is a line of text that explains nothing. */}
          {noApsidesHere && controlFrameLabel(controlFrame) !== undefined && (
            <FrameCaveat>{`Frame: ${controlFrameLabel(controlFrame)}`}</FrameCaveat>
          )}
          {/* A plain div (not a Stack) so the ResizeObserver ref attaches to the
            real measured element: ui-kit's layout primitives don't forward
            refs, and this is the one node in the widget that genuinely needs
            imperative DOM access. */}
        </Section>,
        /* One section, not one per group: this widget measures its own tile and
           swaps the diagram between beside the readouts and under them, which is
           a finer decision than the section grid makes. It fills, so the diagram
           still takes the height the captions leave. */
        <Section key="orbit" fill>
          <div
            ref={bodyRef}
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: isLandscape ? "row" : "column",
              gap: "var(--gap-related)",
            }}
          >
            <Grid
              cols={tight ? "2.2em minmax(0, 1fr)" : "3em minmax(0, 1fr)"}
              align="baseline"
              style={{
                gap: `var(--space-2) ${tight ? "var(--space-6)" : "var(--space-8)"}`,
                alignContent: "start",
                ...(isLandscape ? { flex: "0 0 auto" } : {}),
              }}
            >
              <OrbitLabel>Ap</OrbitLabel>
              <OrbitValue accent="ap" tight={tight} narrow={narrow}>
                {/* Hyperbolic/escape trajectories have no apoapsis. A provider
                  that answers with a sentinel instead of nothing would read as
                  a real "1000.00 Mm", so render an em-dash and let the operator
                  see the absence rather than mistake an escape trajectory for a
                  vast bound orbit. */}
                {noApsidesHere ? (
                  <FrameCaveat title={frameCaveat(apsides, "apoapsis")}>
                    no Ap here
                  </FrameCaveat>
                ) : apoapsisA === undefined ? (
                  NULL_DISPLAY
                ) : hyperbolic ? (
                  NULL_DISPLAY
                ) : (
                  <Unit value={value("m", apoapsisA)} />
                )}
              </OrbitValue>

              <OrbitLabel>Pe</OrbitLabel>
              {/* Sub-surface periapsis (negative altitude) means the vessel
                will impact terrain, promote the readout to the nogo
                alert colour so the operator notices at a glance instead
                of reading "Pe = -5 km" as just another low number. */}
              <OrbitValue
                accent={
                  periapsisA !== undefined && periapsisA < 0 ? "alert" : "pe"
                }
                tight={tight}
                narrow={narrow}
              >
                {noApsidesHere ? (
                  <FrameCaveat title={frameCaveat(apsides, "periapsis")}>
                    no Pe here
                  </FrameCaveat>
                ) : periapsisA === undefined ? (
                  NULL_DISPLAY
                ) : (
                  <Unit value={value("m", periapsisA)} />
                )}
              </OrbitValue>

              {showInclinationRow && (
                <>
                  <OrbitLabel>Inc</OrbitLabel>
                  <OrbitValue tight={tight} narrow={narrow}>
                    {inclination === undefined ? (
                      NULL_DISPLAY
                    ) : (
                      <Unit value={inclination} decimals={1} />
                    )}
                  </OrbitValue>
                </>
              )}

              {showApProgressRows && (
                <>
                  <OrbitLabel>t-Ap</OrbitLabel>
                  <OrbitValue accent="ap" tight={tight} narrow={narrow}>
                    {/* On hyperbolic orbits there's no apoapsis to reach. A
                      zero here would read as "arriving now" on a countdown, so
                      render an em-dash rather than let a hyperbolic flyby look
                      like an imminent event. */}
                    {/* And the frame, on the same footing as the apsis itself: a
                      countdown to an apsis the frame does not have is a time to
                      an event that does not happen, sitting directly under a row
                      saying so. */}
                    {noApsidesHere ? (
                      <FrameCaveat title={frameCaveat(apsides, "apoapsis")}>
                        no Ap here
                      </FrameCaveat>
                    ) : timeToAp === undefined || hyperbolic ? (
                      NULL_DISPLAY
                    ) : (
                      <Countdown value={timeToAp} />
                    )}
                  </OrbitValue>

                  <OrbitLabel>t-Pe</OrbitLabel>
                  <OrbitValue accent="pe" tight={tight} narrow={narrow}>
                    {/* Same hyperbolic guard as t-Ap above: on an escape/flyby the
                      elliptical solver has no periapsis countdown to give (and a
                      legacy 0-sentinel source would read as "arriving now"),
                      render an em-dash rather than a countdown. */}
                    {noApsidesHere ? (
                      <FrameCaveat title={frameCaveat(apsides, "periapsis")}>
                        no Pe here
                      </FrameCaveat>
                    ) : timeToPe === undefined || hyperbolic ? (
                      NULL_DISPLAY
                    ) : (
                      <Countdown value={timeToPe} />
                    )}
                  </OrbitValue>
                </>
              )}

              {showEccentricityRows && (
                <>
                  <OrbitLabel>Ecc</OrbitLabel>
                  <OrbitValue tight={tight} narrow={narrow}>
                    {eccentricity === undefined ? (
                      NULL_DISPLAY
                    ) : (
                      <Unit value={eccentricity} decimals={4} />
                    )}
                  </OrbitValue>

                  <OrbitLabel>T</OrbitLabel>
                  <OrbitValue tight={tight} narrow={narrow}>
                    {/* Period is undefined on a hyperbolic orbit (the
                      trajectory never closes), and a zero there is again
                      indistinguishable from "now". */}
                    {period === undefined || hyperbolic ? (
                      NULL_DISPLAY
                    ) : (
                      <Unit value={value("s", period)} />
                    )}
                  </OrbitValue>
                </>
              )}
            </Grid>

            {showDiagramSlot && (
              <Stack
                style={{
                  flex: "1 1 0",
                  minHeight: "80px",
                  ...(isLandscape
                    ? { minWidth: 0 }
                    : { marginTop: "var(--space-4)" }),
                }}
              >
                {withheld ? (
                  <TrajectoryWithheldNote withheld={withheld} compact />
                ) : (
                  canDrawDiagram && (
                    <OrbitDiagram
                      variant="mini"
                      // The seam's answer, drawn as given. `null` on the conic arm,
                      // where the diagram's own conic renderer is what the provider
                      // said is right.
                      trajectoryPath={
                        trajectory?.shape === "arc" ? trajectory.points : null
                      }
                      trajectoryFarEnd={
                        trajectory?.shape === "arc" ? trajectory.farEnd : null
                      }
                      sma={sma.magnitude}
                      ecc={eccentricity.magnitude}
                      // `apoapsisR` is `null` on a hyperbolic orbit, OrbitDiagram
                      // already detects that itself (`ecc >= 1 || sma <= 0`) and
                      // ignores this value in that branch, so the fallback below is
                      // never actually rendered from.
                      apoapsis={apoapsisR ?? 0}
                      periapsis={periapsisR}
                      trueAnomaly={trueAnomaly ?? 0}
                      argPe={argPe?.magnitude ?? 0}
                      bodyColor={body?.color}
                      bodyRadius={body?.radius}
                      isOrbiting={isOrbiting}
                    />
                  )
                )}
              </Stack>
            )}
          </div>
        </Section>,
      ]}
    />
  );
}

registerComponent<CurrentOrbitConfig>({
  id: "current-orbit",
  name: "Current Orbit",
  description:
    "Displays orbital parameters: apoapsis, periapsis, eccentricity, inclination, period, and time to Ap/Pe.",
  tags: ["telemetry"],
  defaultSize: { w: 9, h: 18 },
  minSize: { w: 3, h: 4 },
  component: CurrentOrbitComponent,
  // One entry per NAMED value the component body reads: the raw elements off
  // `vessel.orbit`, and the two body indices off `vessel.orbit` and
  // `vessel.identity`. Declared per field rather than as the channels so an
  // alarm lands on the widget that draws THAT value; channel granularity would
  // land it on every widget reading the channel.
  //
  // The apsides, the countdowns and the period are not here because they are
  // not a field of anything: they are solved from the elements above, and the
  // channel entry is what carries them.
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: { showDiagram: true },
  actions: currentOrbitActions,
  pushable: true,
  requires: ["flight"],
});

export { CurrentOrbitComponent };

/**
 * The instrument's state when the conic declined: a word the operator reads
 * beside the dashes, in the register of `NO DATA` and `TOO LOW`, never a
 * sentence. One word for every decline, because a state that has to be looked
 * up is worse than the dashes it explains; which condition declined reaches the
 * operator in the note on hover. Every reason is still named, so a new one is a
 * compile error here rather than a silent default.
 *
 * `null` for `input-absent`: without elements there is nothing on the panel for
 * a state to explain, and the dashes already say "not arrived".
 */
function declinedState(declined: ReckoningDecline): string | null {
  const reason = declined.reason;
  switch (reason) {
    case "under-physics":
    case "beyond-horizon":
    case "model-inapplicable":
    case "contested":
    case "insufficient-history":
      return "CANNOT MODEL";
    case "input-absent":
      return null;
    default: {
      const unnamed: never = reason;
      return unnamed;
    }
  }
}

// Plain elements + inline style rather than ui-kit primitives below: the
// label/value pair carries font sizes and letter-spacings off the standard
// scale on purpose (see OrbitValue's own comment), and Value's tone
// vocabulary (accent/default/muted/faint) has no slot for this widget's
// domain tones (ap/pe/alert), so composing it would either lose the exact
// colour or force a mismatched tone name onto a value that isn't one of
// Value's four.

function OrbitLabel({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: "var(--font-size-caption)",
        color: "var(--color-text-faint)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}

/**
 * What stands where a number would, when the operator's own view frame means
 * the quantity does not exist.
 *
 * <p>Words rather than the null-display dash this widget already uses. The dash
 * means "absent on this trajectory", which a hyperbolic orbit's apoapsis is;
 * this is "not a quantity in the frame you are looking through", which is a
 * fact about the operator's own view and one they can act on by changing it.
 * Rendering both the same way would tell them their orbit had changed when only
 * their frame had.</p>
 *
 * <p>Smaller and quieter than a value, because it is not one. The full sentence
 * is on the title so the short form can stay inside a readout cell.</p>
 */
function FrameCaveat({
  children,
  title,
}: {
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      style={{
        fontSize: "var(--font-size-compact)",
        color: "var(--color-text-faint)",
        fontStyle: "italic",
      }}
    >
      {children}
    </span>
  );
}

const ACCENT_COLOR: Record<"ap" | "pe" | "alert", string> = {
  ap: "var(--color-status-warning-bg)",
  pe: "var(--color-tag-blue-fg)",
  alert: "var(--color-status-nogo-bg)",
};

function OrbitValue({
  accent,
  tight,
  narrow,
  children,
}: {
  accent?: "ap" | "pe" | "alert";
  tight: boolean;
  narrow: boolean;
  children: ReactNode;
}) {
  // Force values onto one line: at tiny widget sizes the formatted distance
  // ("85.0 km") wraps inside the value column. Pair with the narrow-width
  // font tiers below so realistic values still fit the ~80-120px of content
  // width without clipping past the panel edge.
  const style: CSSProperties = {
    // Off-scale on purpose: this 13px is the top of a three-tier ladder
    // (13 base / 12 narrow / 10 tight) and --font-size-sm is 12px, so
    // tokenising it merges the base into the narrow tier below. The two
    // must stay one rung apart.
    fontSize: "13px",
    color: accent ? ACCENT_COLOR[accent] : "var(--color-text-primary)",
    letterSpacing: "0.03em",
    whiteSpace: "nowrap",
    minWidth: 0,
  };
  // Narrow panels (3-4 cols) shrink long values rather than clip them; the
  // tiny tier (small on both axes) goes one step smaller still.
  //
  // The narrow tier stays a literal 12px, paired with the base 13px above:
  // --font-size-sm covers both 13 and 12, so tokenising the pair collapses
  // two tiers into one and makes narrow a no-op on desktop, and a 13px no-op
  // on a coarse pointer, which is exactly the size the comment above says
  // clips at 3-4 cols. Only the tight tier lands on a rung of its own.
  if (tight) {
    style.fontSize = "var(--font-size-caption)";
  } else if (narrow) {
    style.fontSize = "12px";
  }
  return <span style={style}>{children}</span>;
}
