import type { ComponentProps, ConfigComponentProps } from "@gonogo/core";
import { registerComponent, useDataValue } from "@gonogo/core";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Panel,
  PanelSubtitle,
  PanelTitle,
  PrimaryButton,
  Select,
} from "@gonogo/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
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

function SystemViewComponent({
  config,
}: Readonly<ComponentProps<SystemViewConfig>>) {
  const frameSetting = config?.frame ?? "auto";
  const bodies = useCelestialBodies();
  const vesselBody = useDataValue("data", "v.body");
  const targetName = useDataValue("data", "tar.name");
  // Vessel orbit — feeds the dot drawn on its own orbit when the
  // chosen frame matches its parent body.
  const vSma = useDataValue("data", "o.sma");
  const vEcc = useDataValue("data", "o.eccentricity");
  const vLan = useDataValue("data", "o.lan");
  const vArgPe = useDataValue("data", "o.argumentOfPeriapsis");
  const vInc = useDataValue("data", "o.inclination");
  const vTrueAnomaly = useDataValue("data", "o.trueAnomaly");
  const vesselOrbit =
    typeof vesselBody === "string" &&
    typeof vSma === "number" &&
    typeof vEcc === "number"
      ? {
          parentName: vesselBody,
          sma: vSma,
          ecc: vEcc,
          lan: typeof vLan === "number" ? vLan : 0,
          argPe: typeof vArgPe === "number" ? vArgPe : 0,
          inclination: typeof vInc === "number" ? vInc : 0,
          trueAnomaly: typeof vTrueAnomaly === "number" ? vTrueAnomaly : 0,
        }
      : null;

  const parentName = resolveFrame(bodies, frameSetting, vesselBody ?? null);

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

  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 360, h: 280 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        if (e.contentRect.width > 0 && e.contentRect.height > 0) {
          setSize({
            w: Math.floor(e.contentRect.width),
            h: Math.floor(e.contentRect.height),
          });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <Panel>
      <PanelTitle>SYSTEM</PanelTitle>
      <PanelSubtitle>
        {bodies.length === 0
          ? "Waiting for Telemachus body data…"
          : parentName === null
            ? "Pick a frame in the widget config."
            : `Frame: ${parentName}`}
      </PanelSubtitle>
      <Body>
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
              width={size.w}
              height={Math.max(size.h, 200)}
            />
          )}
        </DiagramWrap>
        <AlmanacPanel
          body={panelBody}
          phaseAngleDeg={panelPhaseAngle}
          isVesselParent={panelIsVesselParent}
          hohmannIdealDeg={panelHohmann?.ideal ?? null}
          hohmannDeltaDeg={panelHohmann?.delta ?? null}
        />
      </Body>
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
      <PrimaryButton onClick={() => onSave({ frame })}>Save</PrimaryButton>
    </ConfigForm>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const Body = styled.div`
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 200px;
  gap: 0;
  margin-top: 6px;
  border: 1px solid var(--color-surface-panel);
  border-radius: 2px;
  overflow: hidden;
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
    "Solar-system diagram driven by Telemachus's b.* bucket. Renders every body orbiting a chosen parent, highlights the vessel's current body and any selected target.",
  tags: ["telemetry", "navigation"],
  defaultSize: { w: 10, h: 12 },
  component: SystemViewComponent,
  configComponent: SystemViewConfigComponent,
  dataRequirements: ["b.number", "v.body", "tar.name"],
  defaultConfig: { frame: "auto" },
  actions: [],
  pushable: true,
});

export { AlmanacPanel } from "./AlmanacPanel";
export type { CelestialBody } from "./useCelestialBodies";
export { useCelestialBodies } from "./useCelestialBodies";
export { usePhaseAngles } from "./usePhaseAngles";
export { SystemViewComponent };
