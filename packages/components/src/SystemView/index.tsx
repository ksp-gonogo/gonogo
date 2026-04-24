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
   * Body to render the diagram around. "auto" picks the topmost parent
   * of the vessel's current body (e.g. Kerbol when the vessel is on/
   * around Kerbin); "current" follows `v.body`. Empty / unknown string
   * falls back to "auto".
   */
  frame?: "auto" | "current" | string;
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
  if (setting === "current") return vesselBody;
  if (setting === "auto") {
    // Walk up from the vessel's body to the root (a body with no
    // referenceBody, i.e. the star). If the vessel is on Kerbin, the
    // default frame is Kerbol; if around Mun, it's also Kerbol — because
    // seeing the whole system is usually more useful than a two-body
    // snapshot.
    if (!vesselBody) {
      // No vessel body yet — fall back to the first body with no parent.
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
          <option value="auto">Auto (root parent of current body)</option>
          <option value="current">Current body (v.body)</option>
          {bodies
            .filter((b) => b.name !== null)
            .map((b) => (
              <option key={b.index} value={b.name ?? ""}>
                {b.name}
              </option>
            ))}
        </Select>
        <FieldHint>
          "Auto" walks up the reference-body chain from the vessel so a
          Kerbin-orbit mission sees Kerbol, and a Mun mission also sees Kerbol
          (not just Kerbin). "Current body" keeps the camera locked to whatever
          the vessel is currently around.
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
