import type { AvionicsStatus, ComponentProps } from "@ksp-gonogo/sitrep-sdk";
import { registerComponent, useTelemetry } from "@ksp-gonogo/sitrep-sdk";
import {
  BigReadout,
  Cluster,
  NULL_DISPLAY,
  Panel,
  PanelTitle,
  ReadoutCaption,
  type ReadoutTone,
  Stack,
  StatusPill,
} from "@ksp-gonogo/ui-kit";

type AvionicsConfig = Record<string, never>;

function fmtTons(t?: number): string {
  return t == null ? NULL_DISPLAY : `${t.toFixed(2)} t`;
}

/**
 * RP-1 ascent controllability go/no-go. Reads the single `avionics.status`
 * Topic (see GonogoAvionicsUplink) and shows whether the vessel's current mass
 * is within the active avionics unit's controllable-mass limit. The state text
 * (GO / NO-GO / NO AVIONICS) carries the meaning, colour is reinforcement, not
 * the sole signal: and the state block is a polite live region so the go/no-go
 * flip is announced without flooding.
 */
export function AvionicsGoNoGoComponent(
  _props: ComponentProps<AvionicsConfig>,
) {
  const s = useTelemetry("avionics.status") as AvionicsStatus | undefined;
  const noAvionics = !(s?.avionicsActive ?? false);
  const controllable = s?.controllable ?? false;
  const label = noAvionics ? "NO AVIONICS" : controllable ? "GO" : "NO-GO";
  const tone: ReadoutTone = noAvionics
    ? "warning"
    : controllable
      ? "go"
      : "alert";
  return (
    <Panel>
      <PanelTitle>Avionics Control</PanelTitle>
      <Stack role="status" aria-live="polite">
        <StatusPill $tone={tone}>{label}</StatusPill>
        <Cluster>
          <div>
            <BigReadout>{fmtTons(s?.vesselMassTons)}</BigReadout>
            <ReadoutCaption>Vessel mass</ReadoutCaption>
          </div>
          <div>
            <BigReadout $tone={tone}>
              {fmtTons(s?.controllableMassTons)}
            </BigReadout>
            <ReadoutCaption>Controllable</ReadoutCaption>
          </div>
        </Cluster>
      </Stack>
    </Panel>
  );
}

registerComponent<AvionicsConfig>({
  id: "avionics-go-no-go",
  name: "Avionics Control",
  description:
    "RP-1 ascent controllability: is the vessel mass within the active avionics unit's tonnage limit.",
  tags: ["control", "ro"],
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 2, h: 3 },
  component: AvionicsGoNoGoComponent,
  channels: ["avionics.status"],
  defaultConfig: {},
  actions: [],
  requires: ["flight"],
});
