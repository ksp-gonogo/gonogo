import type { ActionDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  getBody,
  registerComponent,
  useActionInput,
  useOrbitElements,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  type OrbitTrajectory,
  useOrbitTrajectory,
  useStream,
  type VesselState,
} from "@ksp-gonogo/sitrep-client";
import {
  apsidesExist,
  type ControlFrame,
  frameCaveat,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Countdown,
  Grid,
  NULL_DISPLAY,
  Panel,
  Stack,
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { OrbitDiagram } from "../shared/OrbitDiagram";
import { TrajectoryFrameCaption } from "../shared/trajectoryFrame";
import { TrajectoryWithheldNote } from "../shared/trajectoryWithheld";
import { useIsOrbiting } from "../shared/useIsOrbiting";

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

  const {
    apoapsisAltitude: apoapsisA,
    periapsisAltitude: periapsisA,
    apoapsisRadius: apoapsisR,
    periapsisRadius: periapsisR,
    timeToApoapsis: timeToAp,
    timeToPeriapsis: timeToPe,
  } = useOrbitElements();

  /**
   * What the operator's own view frame does to these two numbers.
   *
   * An apsis is defined against a centre, and the frames defined by a pair of
   * bodies have none; a frame defined against the target has none whatever kind
   * it carries. In those an apoapsis is not merely unmeasured, it does not
   * exist, and that is a different thing to tell someone than an em-dash, which
   * this widget already uses to mean "absent on this trajectory".
   */
  const controlFrame = useStream<ControlFrame>("system.frame");
  const apsides = apsidesExist(controlFrame);
  const noApsidesHere = apsides === "invalid";
  // Every read rides the SDK stream directly, no legacy `useTelemetry("data",
  // ...)` fallback:
  //   - sma/eccentricity/inclination/argPe are raw `vessel.orbit.*` elements,
  //     read off the canonical whole-`vessel.orbit` Topic.
  //   - trueAnomaly/period (+ Ap/Pe/ApR/PeR/timeToAp/timeToPe via
  //     `useOrbitElements`) and referenceBody/bodyName are SDK-derived
  //     `vessel.state.*` fields (deriveVesselState: trueAnomaly propagated at
  //     view-UT, referenceBodyName/parentBodyName resolved index → name against
  //     `system.bodies`). `vessel.state` isn't a wire `TopicId`, so it reads
  //     through `useStream`.
  // This widget DRAWS the orbit and the craft's place on it, which is a marker:
  // a positive claim about where it is now. So the elements come from a CURRENT
  // reading, or from a model where one is on offer, and otherwise from nothing,
  // and the diagram's own absent-value rendering takes over. Same decision as
  // MapView, SystemView and FleetComms.
  const orbitReading = useTelemetry("vessel.orbit");
  const orbit =
    orbitReading.state === "observed"
      ? orbitReading.value
      : orbitReading.state === "reckonable"
        ? orbitReading.reckoned.value
        : undefined;
  const orbitStale = orbitReading.state === "stale";
  const vesselState = useStream<VesselState>("vessel.state");
  const sma = orbit?.sma;
  const eccentricity = orbit?.ecc;
  const argPe = orbit?.argPe;
  const inclination = orbit?.inc;
  const trueAnomaly = vesselState?.trueAnomaly ?? undefined;
  const period = vesselState?.period ?? undefined;
  const refBody = vesselState?.referenceBodyName ?? undefined;
  const bodyName = vesselState?.parentBodyName ?? undefined;
  // Connectivity indicator: `o.sma` is the representative topic (its resolved
  // `vessel.orbit.sma` stream drives the badge).

  // What the mini diagram's curve IS, asked of the propagation seam rather than
  // decided here. The numbers in the grid above are a different question and go
  // on rendering either way: `sma`, `ecc` and the apsides were measured at the
  // sample instant and are true whoever computed them. Only the CURVE claims
  // what the craft will fly, so only the curve is refusable.
  const trajectory: OrbitTrajectory | null = useOrbitTrajectory(orbit);
  const withheld =
    trajectory !== null && trajectory.shape === "withheld" ? trajectory : null;

  const body =
    (bodyName ?? refBody) === undefined
      ? undefined
      : getBody(bodyName ?? refBody ?? "");
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
  // orbit (no apoapsis exists) by design (`VesselState.apoapsisRadius`), not
  // an error. Periapsis is always real whenever there's a resolvable orbit,
  // so it (plus sma/eccentricity) is the true "do we have an orbit" signal.
  // `!= null` catches both `null` and `undefined`, `apoapsisR`/`periapsisR`
  // are `useOrbitElements`' apsis radii, which pass `null` through as-is
  // (see that hook's own doc comment).
  const hasOrbit = sma != null && eccentricity != null && periapsisR != null;

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
  const showDiagramSlot =
    showDiagram && hasOrbit && cols >= 5 && (rows >= 8 || cols >= 10);
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
    <Panel panelTitle="ORBIT">
      {/* Reference body as an in-body caption (staging relocated it out of
          the Panel subtitle slot); a plain span carries the muted caption
          type without styled-components. */}
      {showSubtitle && refBody !== undefined && (
        <span
          style={{
            fontSize: "var(--font-size-xs)",
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
      {/* A plain div (not a Stack) so the ResizeObserver ref attaches to the
          real measured element: ui-kit's layout primitives don't forward
          refs, and this is the one node in the widget that genuinely needs
          imperative DOM access. */}
      <div
        ref={bodyRef}
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: isLandscape ? "row" : "column",
          gap: "var(--space-8)",
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
            accent={periapsisA !== undefined && periapsisA < 0 ? "alert" : "pe"}
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
                {timeToAp === undefined || hyperbolic ? (
                  NULL_DISPLAY
                ) : (
                  <Countdown value={timeToAp} />
                )}
              </OrbitValue>

              <OrbitLabel>t-Pe</OrbitLabel>
              <OrbitValue accent="pe" tight={tight} narrow={narrow}>
                {/* Same hyperbolic guard as t-Ap above: on an escape/flyby the
                    elliptical solver degrades timeToPe to null (and a legacy
                    0-sentinel source would read as "arriving now"), render an
                    em-dash rather than a countdown. `=== undefined` alone
                    misses `null` (`null === undefined` is false). */}
                {timeToPe === undefined || timeToPe === null || hyperbolic ? (
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
            )}
          </Stack>
        )}
      </div>
    </Panel>
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
  // One entry per value the component body actually reads, in the two groups
  // its own comment describes: raw elements off `vessel.orbit`, everything
  // else off the derived `vessel.state` (six of them through
  // `useOrbitElements`). Declared per field rather than as the two channels so
  // an alarm lands on the widget that draws THAT value, which is what the
  // legacy keys used to buy.
  dataRequirements: [
    "vessel.orbit.sma",
    "vessel.orbit.ecc",
    "vessel.orbit.inc",
    "vessel.orbit.argPe",
    "vessel.state.apoapsisAlt",
    "vessel.state.periapsisAlt",
    "vessel.state.apoapsisRadius",
    "vessel.state.periapsisRadius",
    "vessel.state.timeToAp",
    "vessel.state.timeToPe",
    "vessel.state.trueAnomaly",
    "vessel.state.period",
    "vessel.state.referenceBodyName",
    "vessel.state.parentBodyName",
  ],
  defaultConfig: { showDiagram: true },
  actions: currentOrbitActions,
  pushable: true,
  requires: ["flight"],
});

export { CurrentOrbitComponent };

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
        fontSize: "var(--font-size-xs)",
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
        fontSize: "var(--font-size-xs)",
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
    style.fontSize = "var(--font-size-2xs)";
  } else if (narrow) {
    style.fontSize = "12px";
  }
  return <span style={style}>{children}</span>;
}
