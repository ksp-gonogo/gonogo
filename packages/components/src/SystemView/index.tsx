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
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { SystemDiagram } from "./SystemDiagram";
import { useCelestialBodies } from "./useCelestialBodies";

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

  const parentName = resolveFrame(bodies, frameSetting, vesselBody ?? null);

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
      <DiagramWrap ref={wrapRef}>
        {parentName !== null && bodies.length > 0 && (
          <SystemDiagram
            bodies={bodies}
            parentName={parentName}
            highlightNames={vesselBody ? [vesselBody] : []}
            targetName={typeof targetName === "string" ? targetName : null}
            width={size.w}
            height={Math.max(size.h, 200)}
          />
        )}
      </DiagramWrap>
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

const DiagramWrap = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  margin-top: 6px;
  background: #050505;
  border: 1px solid #111;
  border-radius: 2px;
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

export type { CelestialBody } from "./useCelestialBodies";
export { useCelestialBodies } from "./useCelestialBodies";
export { SystemViewComponent };
