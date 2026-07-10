import type {
  ComponentProps,
  ConfigComponentProps,
  OrbitPatch,
} from "@gonogo/core";
import {
  registerComponent,
  resolveTargetName,
  useTelemetry,
} from "@gonogo/core";
import {
  type OrbitElements,
  solveAnomalies,
  useViewUt,
} from "@gonogo/sitrep-client";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Panel,
  PanelSubtitle,
  PanelTitle,
  Select,
  useModalSaveBar,
} from "@gonogo/ui";
import { useMemo, useState } from "react";
import styled from "styled-components";
import { quantiseUt } from "../MapView/predictionThrottle";
import { useElementSize } from "../shared/useElementSize";
import { AlmanacPanel } from "./AlmanacPanel";
import { SystemDiagram } from "./SystemDiagram";
import {
  angleDelta,
  hohmannPhaseAngle,
  type TransferStatus,
  transferStatus,
} from "./transferWindow";
import { type CelestialBody, useCelestialBodies } from "./useCelestialBodies";
import { usePhaseAngles } from "./usePhaseAngles";

interface SystemViewConfig {
  /**
   * Body to render the diagram around. "auto" follows the vessel's
   * current body (`v.body`) so a Kerbin-launch shows Mun/Minmus and a
   * Mun-orbit shows Mun's neighbourhood. "root" walks up to the topmost
   * parent (Kerbol from anywhere in the Kerbin system). An explicit body
   * name pins the frame regardless of vessel state.
   */
  frame?: "auto" | "root" | string;
}

// ── Client-side orbit derivations ───────────────────────────────────────────────
// Mirror `@gonogo/sitrep-client`'s `deriveVesselState` (vessel-state.ts) so the
// widget reconstructs the scalars it used to read off Telemachus's `o.*` keys
// (trueAnomaly / next-apsis / encounter) directly from the streamed
// `vessel.orbit` elements + the SDK view-UT — the R6 §0.0/§1b client-side
// REDESIGN. `vessel.orbit`'s angles are DEGREES on the wire (KSP-native), while
// `kepler`'s `OrbitElements` is all-radians, so this is the one place the mix is
// normalised (meanAnomalyAtEpoch is already radians — the documented KSP quirk).

/** `Sitrep.Contract.TransitionType` ordinals the encounter chip surfaces. */
const TRANSITION_TYPE_ENCOUNTER = 2;
const TRANSITION_TYPE_ESCAPE = 3;

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function wrapDegrees360(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function finiteOrNull(x: number): number | null {
  return Number.isFinite(x) ? x : null;
}

interface WireOrbit {
  sma: number;
  ecc: number;
  inc: number;
  lan?: number;
  argPe?: number;
  meanAnomalyAtEpoch: number;
  epoch: number;
  mu: number;
}

function buildElements(o: WireOrbit): OrbitElements {
  return {
    sma: o.sma,
    ecc: o.ecc,
    inc: degToRad(o.inc),
    lan: o.lan == null ? 0 : degToRad(o.lan),
    argPe: o.argPe == null ? 0 : degToRad(o.argPe),
    meanAnomalyAtEpoch: o.meanAnomalyAtEpoch,
    epoch: o.epoch,
    mu: o.mu,
  };
}

/**
 * Seconds from `meanAnomaly` (rad) until it next reaches `target` (rad), wrapped
 * forward to `[0, period)`. `null` for a non-positive/non-finite mean motion.
 */
function timeToMeanAnomaly(
  meanAnomaly: number,
  target: number,
  meanMotion: number,
): number | null {
  if (
    !Number.isFinite(meanAnomaly) ||
    !Number.isFinite(meanMotion) ||
    meanMotion <= 0
  ) {
    return null;
  }
  const twoPi = 2 * Math.PI;
  let delta = (target - meanAnomaly) % twoPi;
  if (delta < 0) delta += twoPi;
  return delta / meanMotion;
}

/** Whichever of `timeToAp`/`timeToPe` is the smaller non-null countdown. */
function nextApsisOf(
  timeToAp: number | null,
  timeToPe: number | null,
): { nextApsisType: number | null; timeToNextApsis: number | null } {
  if (timeToAp != null && (timeToPe == null || timeToAp <= timeToPe)) {
    return { nextApsisType: 1, timeToNextApsis: timeToAp };
  }
  if (timeToPe != null) {
    return { nextApsisType: -1, timeToNextApsis: timeToPe };
  }
  return { nextApsisType: null, timeToNextApsis: null };
}

function SystemViewComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<SystemViewConfig>>) {
  const frameSetting = config?.frame ?? "auto";
  const bodies = useCelestialBodies();
  // Streamed Topics (R6 de-Telemachus): raw `vessel.*` records read straight
  // off the Uplink store via the canonical `useTelemetry(TopicId)` hook — no
  // legacy `DataSource` fallback. The scalars the widget used to read off
  // Telemachus's derived `o.*` keys (trueAnomaly / next-apsis / encounter) are
  // reconstructed client-side below from `vessel.orbit`'s elements + the SDK
  // view-UT (§0.0/§1b REDESIGN).
  const orbit = useTelemetry("vessel.orbit");
  const identity = useTelemetry("vessel.identity");
  const systemBodies = useTelemetry("system.bodies");
  const targetName = resolveTargetName(useTelemetry("vessel.target")?.name);
  // View-UT — the SDK view time the propagation already evaluates at (the R6
  // `t.universalTime` DROP: it was never a stream, it IS `sdk.view.ut()`).
  const universalTime = useViewUt();

  // Stable body-index → NAME map (from `system.bodies`' stable `index`, never
  // array position) — the display-map behind `v.body` / `o.encounterBody`.
  const nameByIndex = useMemo(() => {
    const m = new Map<number, string>();
    for (const b of systemBodies?.bodies ?? []) {
      if (b.name != null) m.set(b.index, b.name);
    }
    return m;
  }, [systemBodies]);

  // Vessel's current body NAME (old Telemachus `v.body`) — parentBodyIndex
  // resolved against `system.bodies`.
  const vesselBody =
    identity?.parentBodyIndex != null
      ? (nameByIndex.get(identity.parentBodyIndex) ?? null)
      : null;

  // Client-derived orbital scalars at view-UT (mirrors deriveVesselState:
  // trueAnomaly for the vessel dot, period, and the next-apsis countdown).
  const derived = useMemo(() => {
    if (!orbit || universalTime == null || !Number.isFinite(universalTime)) {
      return null;
    }
    const elements = buildElements(orbit);
    const anomalies = solveAnomalies(elements, universalTime);
    const trueAnomaly = finiteOrNull(
      wrapDegrees360(radToDeg(anomalies.trueAnomaly)),
    );
    const period = finiteOrNull((2 * Math.PI) / anomalies.meanMotion);
    const timeToAp = timeToMeanAnomaly(
      anomalies.meanAnomaly,
      Math.PI,
      anomalies.meanMotion,
    );
    const timeToPe = timeToMeanAnomaly(
      anomalies.meanAnomaly,
      0,
      anomalies.meanMotion,
    );
    return { trueAnomaly, period, ...nextApsisOf(timeToAp, timeToPe) };
  }, [orbit, universalTime]);

  // Next SOI transition (old Telemachus `o.encounter*`) from the streamed
  // `vessel.orbit.encounter` record.
  const encounter = orbit?.encounter ?? null;
  const encounterExists =
    encounter?.transitionType === TRANSITION_TYPE_ENCOUNTER
      ? 1
      : encounter?.transitionType === TRANSITION_TYPE_ESCAPE
        ? -1
        : 0;
  const encounterBody =
    encounter?.bodyIndex != null
      ? (nameByIndex.get(encounter.bodyIndex) ?? null)
      : null;
  const encounterTimeUt =
    encounter && Number.isFinite(encounter.transitionUt)
      ? encounter.transitionUt
      : null;

  // Vessel orbit — feeds the dot drawn on its own orbit when the chosen frame
  // matches its parent body.
  const vSma = orbit?.sma;
  const vesselOrbit =
    vesselBody != null && orbit && typeof orbit.sma === "number"
      ? {
          parentName: vesselBody,
          sma: orbit.sma,
          ecc: orbit.ecc,
          lan: orbit.lan ?? 0,
          argPe: orbit.argPe ?? 0,
          inclination: orbit.inc,
          trueAnomaly: derived?.trueAnomaly ?? 0,
        }
      : null;

  const parentName = resolveFrame(bodies, frameSetting, vesselBody);

  // Predicted trajectory input for the diagram. Throttle `ut` into 1s buckets
  // (same as MapView) so the patch projection only re-runs ~1/sec, not on
  // every stream frame — the orbit shape doesn't change between ticks.
  const utBucket = quantiseUt(
    typeof universalTime === "number" ? universalTime : undefined,
    1,
  );
  // Client-propagated predicted trajectory (R6 §0.0 REDESIGN): with only the
  // current elements + the next transition on the wire, the honestly-drawable
  // chain is a single conic — the current orbit sampled from the view-UT to the
  // encounter (an arc terminated at the SOI boundary) or, with no encounter,
  // over one full period (a closed ellipse). Built as the core `OrbitPatch`
  // shape so `SystemDiagram`'s existing Keplerian projection samples it
  // unchanged. The post-encounter conic's elements aren't on the wire, so the
  // chain never fabricates a second patch; the encounter is surfaced separately
  // from the derived `encounter*` scalars above (subtitle + almanac).
  const orbitPatches = useMemo<OrbitPatch[]>(() => {
    if (!orbit || vesselBody == null || utBucket == null) return [];
    const period = derived?.period;
    if (period == null || period <= 0) return [];
    if (!(orbit.ecc < 1)) return []; // hyperbolic — elliptical solver only
    const hasEncounter =
      encounterExists !== 0 &&
      encounterTimeUt != null &&
      encounterTimeUt > utBucket;
    const endUT = hasEncounter
      ? (encounterTimeUt as number)
      : utBucket + period;
    return [
      {
        startUT: utBucket,
        endUT,
        patchStartTransition: "INITIAL",
        patchEndTransition: hasEncounter
          ? encounterExists === -1
            ? "ESCAPE"
            : "ENCOUNTER"
          : "FINAL",
        PeA: 0,
        ApA: 0,
        inclination: orbit.inc,
        eccentricity: orbit.ecc,
        epoch: orbit.epoch,
        period,
        argumentOfPeriapsis: orbit.argPe ?? 0,
        sma: orbit.sma,
        lan: orbit.lan ?? 0,
        maae: orbit.meanAnomalyAtEpoch,
        referenceBody: vesselBody,
        semiLatusRectum: 0,
        semiMinorAxis: 0,
        closestEncounterBody: encounterBody,
      },
    ];
  }, [
    orbit,
    vesselBody,
    utBucket,
    derived,
    encounterExists,
    encounterTimeUt,
    encounterBody,
  ]);
  const predicted = useMemo(
    () =>
      orbitPatches.length > 0 && utBucket != null
        ? { orbitPatches, ut: utBucket }
        : null,
    [orbitPatches, utBucket],
  );

  // Children of the chosen frame — the only bodies actually drawn. Phase
  // angles only get subscribed for these, so the b.o.phaseAngle[i] sub
  // count tracks what's on screen, not the whole solar system.
  const children = useMemo(() => {
    if (parentName === null) return [] as readonly CelestialBody[];
    return bodies.filter(
      (b) => b.referenceBody !== null && b.referenceBody === parentName,
    );
  }, [bodies, parentName]);
  const phaseAngles = usePhaseAngles(children);

  // Transfer-window highlighting. Only meaningful when the rendered frame is
  // the same parent the vessel orbits — otherwise the bodies aren't co-orbital
  // with the vessel and the Hohmann formula doesn't apply.
  const transferStatuses = useMemo(() => {
    const out = new Map<number, "go" | "soon">();
    if (typeof vesselBody !== "string") return out;
    if (parentName !== vesselBody) return out;
    if (typeof vSma !== "number" || !Number.isFinite(vSma)) return out;
    for (const child of children) {
      const rB = child.semiMajorAxis;
      if (typeof rB !== "number" || !Number.isFinite(rB)) continue;
      const live = phaseAngles.get(child.index);
      if (typeof live !== "number") continue;
      const ideal = hohmannPhaseAngle(vSma, rB);
      if (!Number.isFinite(ideal)) continue;
      const delta = angleDelta(live, ideal);
      const status: TransferStatus = transferStatus(delta);
      if (status !== "off") out.set(child.index, status);
    }
    return out;
  }, [children, phaseAngles, vesselBody, parentName, vSma]);

  const [focusedBody, setFocusedBody] = useState<CelestialBody | null>(null);
  // Default focus to the vessel's body when nothing is hovered — gives the
  // panel useful content out of the box.
  const vesselBodyRecord = useMemo(
    () =>
      typeof vesselBody === "string"
        ? (bodies.find((b) => b.name === vesselBody) ?? null)
        : null,
    [bodies, vesselBody],
  );
  const panelBody = focusedBody ?? vesselBodyRecord;
  const nowUt = typeof universalTime === "number" ? universalTime : null;
  const panelPhaseAngle =
    panelBody && phaseAngles.has(panelBody.index)
      ? (phaseAngles.get(panelBody.index) ?? null)
      : null;
  const panelIsVesselParent =
    panelBody !== null &&
    typeof vesselBody === "string" &&
    panelBody.name === vesselBody;
  // Hohmann ideal + delta for the panel's body, if all the inputs line up.
  const panelHohmann =
    panelBody !== null &&
    typeof vesselBody === "string" &&
    parentName === vesselBody &&
    panelBody.referenceBody === vesselBody &&
    typeof vSma === "number" &&
    Number.isFinite(vSma) &&
    typeof panelBody.semiMajorAxis === "number" &&
    Number.isFinite(panelBody.semiMajorAxis)
      ? (() => {
          const ideal = hohmannPhaseAngle(vSma, panelBody.semiMajorAxis);
          if (!Number.isFinite(ideal)) return null;
          const delta =
            panelPhaseAngle !== null
              ? angleDelta(panelPhaseAngle, ideal)
              : null;
          return { ideal, delta };
        })()
      : null;

  // Diagram column size — feeds the SVG viewBox aspect. This is the 1fr grid
  // child, so it legitimately shrinks when the side almanac mounts.
  const { ref: wrapRef, size } = useElementSize({ w: 360, h: 280 });

  // Whole-tile size — drives the portrait/landscape decision. Measured on the
  // grid *container* (Body), whose border-box is fixed by `flex:1` and does NOT
  // change when the inner grid-template flips between side/bottom almanac. (If
  // orientation were derived from the diagram column instead, mounting the side
  // panel would shrink that column, flip the reading to portrait, and oscillate.)
  const { ref: tileRef, size: tileSize } = useElementSize({ w: 360, h: 280 });

  // Selective rendering — diagram needs real area; almanac sidebar is
  // wide chrome. At small sizes collapse to a text "Frame: X" summary.
  const cols = w ?? 10;
  const rows = h ?? 12;
  const showDiagram = rows >= 5 && cols >= 5;
  // Orientation is taken from the *measured pixel* aspect, not raw grid
  // units — grid rows are shorter than columns are wide, so a 10×12
  // (rows>cols) tile is actually near-square in pixels and must keep the
  // side panel. Only a clearly taller-than-wide tile (e.g. 5×18) reads as
  // portrait and flows the almanac to the bottom. The threshold (1.3) keeps
  // near-square tiles on the side layout.
  const isPortrait = tileSize.h > tileSize.w * 1.3;
  // Almanac placement: beside the diagram needs spare *width* (cols ≥ 9);
  // stacked below needs spare *height* (rows ≥ 12, since the bottom strip
  // eats vertical room the diagram would otherwise use). Splitting the gate
  // by axis means both aspect extremes can show the almanac: a wide-short
  // 18×5 keeps the side panel (its own ScrollArea handles the short height),
  // a tall-narrow 5×18 gets the bottom strip.
  const showSideAlmanac = !isPortrait && rows >= 5 && cols >= 9;
  const showBottomAlmanac = isPortrait && rows >= 12;
  const showAlmanac = showSideAlmanac || showBottomAlmanac;

  return (
    <Panel>
      <PanelTitle>SYSTEM</PanelTitle>
      <PanelSubtitle>
        {bodies.length === 0
          ? "Waiting for body data…"
          : parentName === null
            ? "Pick a frame in the widget config."
            : encounterExists !== 0 && encounterBody != null
              ? `Frame: ${parentName} · next ${
                  encounterExists === -1 ? "escape" : "encounter"
                }: ${encounterBody}`
              : `Frame: ${parentName}`}
      </PanelSubtitle>
      {showDiagram ? (
        <Body
          ref={tileRef}
          $almanac={
            showSideAlmanac ? "side" : showBottomAlmanac ? "bottom" : "none"
          }
        >
          <DiagramWrap ref={wrapRef}>
            {parentName !== null && bodies.length > 0 && (
              <SystemDiagram
                bodies={bodies}
                parentName={parentName}
                highlightNames={vesselBody ? [vesselBody] : []}
                targetName={typeof targetName === "string" ? targetName : null}
                vessel={vesselOrbit}
                phaseAngles={phaseAngles}
                transferStatuses={transferStatuses}
                onFocusBodyChange={setFocusedBody}
                predicted={predicted}
                width={size.w}
                height={size.h}
              />
            )}
          </DiagramWrap>
          {showAlmanac && (
            <AlmanacPanel
              placement={showBottomAlmanac ? "bottom" : "side"}
              body={panelBody}
              phaseAngleDeg={panelPhaseAngle}
              isVesselParent={panelIsVesselParent}
              hohmannIdealDeg={panelHohmann?.ideal ?? null}
              hohmannDeltaDeg={panelHohmann?.delta ?? null}
              encounterDirection={
                // The vessel's next SOI transition (client-derived from
                // `vessel.orbit.encounter`), shown on the panel body it targets.
                encounterExists !== 0 &&
                encounterBody != null &&
                panelBody !== null &&
                panelBody.name === encounterBody
                  ? encounterExists === -1
                    ? "escape"
                    : "encounter"
                  : null
              }
              encounterTimeSec={
                // `encounterTimeUt` is an ABSOLUTE UT (transitionUt); the panel
                // wants seconds-to-event, so subtract the view-UT.
                encounterTimeUt != null && nowUt !== null
                  ? encounterTimeUt - nowUt
                  : null
              }
              nextApsisType={
                derived?.nextApsisType === -1 || derived?.nextApsisType === 1
                  ? derived.nextApsisType
                  : null
              }
              nextApsisTimeSec={
                typeof derived?.timeToNextApsis === "number"
                  ? derived.timeToNextApsis
                  : null
              }
            />
          )}
        </Body>
      ) : (
        <CompactBody>
          <CompactValue>{parentName ?? "—"}</CompactValue>
          {typeof vesselBody === "string" && vesselBody !== parentName && (
            <CompactSub>vessel · {vesselBody}</CompactSub>
          )}
        </CompactBody>
      )}
    </Panel>
  );
}

function resolveFrame(
  bodies: readonly { name: string | null; referenceBody: string | null }[],
  setting: string,
  vesselBody: string | null,
): string | null {
  if (setting === "auto") {
    // Follow the vessel's current body. On the launchpad / in Kerbin
    // orbit this is Kerbin (so the diagram shows Mun/Minmus); from Mun
    // orbit it's Mun. If we don't have v.body yet, fall back to the
    // root so something useful renders.
    if (vesselBody) return vesselBody;
    const root = bodies.find((b) => !b.referenceBody);
    return root?.name ?? null;
  }
  if (setting === "root") {
    // Walk up to the topmost parent (Kerbol from anywhere in the system).
    if (!vesselBody) {
      const root = bodies.find((b) => !b.referenceBody);
      return root?.name ?? null;
    }
    let cursor: string | null = vesselBody;
    const seen = new Set<string>();
    while (cursor !== null && !seen.has(cursor)) {
      seen.add(cursor);
      const body = bodies.find((b) => b.name === cursor);
      if (!body) break;
      if (!body.referenceBody) return body.name;
      cursor = body.referenceBody;
    }
    return cursor;
  }
  // Back-compat: previous default was "current"; treat as "auto".
  if (setting === "current") return vesselBody;
  return setting; // explicit body name
}

// ── Config ────────────────────────────────────────────────────────────────────

function SystemViewConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<SystemViewConfig>>) {
  const bodies = useCelestialBodies();
  const [frame, setFrame] = useState(config?.frame ?? "auto");

  const candidate = useMemo<SystemViewConfig>(() => ({ frame }), [frame]);

  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="system-frame">Frame of reference</FieldLabel>
        <Select
          id="system-frame"
          value={frame}
          onChange={(e) => setFrame(e.target.value)}
        >
          <option value="auto">Auto (current body)</option>
          <option value="root">Root parent (whole system)</option>
          {bodies
            .filter((b) => b.name !== null)
            .map((b) => (
              <option key={b.index} value={b.name ?? ""}>
                {b.name}
              </option>
            ))}
        </Select>
        <FieldHint>
          "Auto" follows the vessel's current body — Kerbin-orbit shows
          Mun/Minmus, Mun-orbit shows Mun. "Root parent" walks up to the star so
          you see the whole system. Pick a specific body to pin the frame.
        </FieldHint>
      </Field>
    </ConfigForm>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const Body = styled.div<{ $almanac: "side" | "bottom" | "none" }>`
  flex: 1;
  min-height: 0;
  display: grid;
  /* "side": almanac is a fixed 200px right column (wide/near-square tiles).
     "bottom": almanac is a flexible strip under the diagram, capped to ~45%
     of the tile height so a tall-narrow column keeps the diagram legible.
     "none": diagram fills the whole tile. Every track is min-0 so the grid
     caps its child rather than letting the almanac's ScrollArea overflow and
     get hard-clipped by this container's overflow:hidden. */
  ${({ $almanac }) =>
    $almanac === "side"
      ? "grid-template-columns: minmax(0, 1fr) 200px; grid-template-rows: minmax(0, 1fr);"
      : $almanac === "bottom"
        ? "grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(0, 45%);"
        : "grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr);"}
  gap: 0;
  margin-top: 6px;
  border: 1px solid var(--color-surface-panel);
  border-radius: 2px;
  overflow: hidden;
`;

const CompactBody = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
`;

const CompactValue = styled.div`
  font-size: 22px;
  font-weight: 700;
  color: var(--color-text-primary);
  letter-spacing: 0.04em;
`;

const CompactSub = styled.div`
  font-size: 11px;
  color: var(--color-text-muted);
  letter-spacing: 0.05em;
`;

const DiagramWrap = styled.div`
  min-width: 0;
  min-height: 0;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  background: var(--color-surface-app);
  svg {
    display: block;
    flex: 1;
  }
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<SystemViewConfig>({
  id: "system-view",
  name: "System View",
  description:
    "Solar-system diagram of every body orbiting a chosen parent, highlighting the vessel's current body and any selected target.",
  tags: ["telemetry", "navigation"],
  defaultSize: { w: 10, h: 12 },
  minSize: { w: 3, h: 4 },
  component: SystemViewComponent,
  configComponent: SystemViewConfigComponent,
  // The body table + phase angles still fan out over the shared `b.*` hooks
  // (`useCelestialBodies`/`usePhaseAngles`) — a separate, shared-hook migration.
  // Everything else reads the streamed `vessel.*`/`system.bodies` Topics below.
  dataRequirements: ["b.number"],
  optionalChannels: [
    "vessel.orbit",
    "vessel.identity",
    "vessel.target",
    "system.bodies",
  ],
  defaultConfig: { frame: "auto" },
  actions: [],
  pushable: true,
});

export { AlmanacPanel } from "./AlmanacPanel";
export type { CelestialBody } from "./useCelestialBodies";
export { useCelestialBodies } from "./useCelestialBodies";
export { usePhaseAngles } from "./usePhaseAngles";
export { SystemViewComponent };
