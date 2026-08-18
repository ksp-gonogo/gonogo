import type { ComponentProps, Value } from "@ksp-gonogo/sitrep-sdk";
import {
  judgeable,
  registerComponent,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
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
  Unit,
} from "@ksp-gonogo/ui-kit";
import type { AvionicsStatus } from "../__generated__/contract";
// Side-effect import: registers avionics.status's unit map into the SDK's
// runtime hydration registry (registerTopicUnits) and augments
// TopicPayloadMap for the type. This widget is the one actual consumer of
// that decode-time wrap (vesselMassTons/controllableMassTons arrive as
// Value<"t">), so it pulls the registration itself rather than relying on
// the package entry point's import order (see ../index.ts, which also
// imports this for the same reason).
import "../topics";

type AvionicsConfig = Record<string, never>;

/**
 * A mass readout, the way an Uplink is meant to write one: the value carries
 * its own unit off the Topic, so this names neither the unit nor the format.
 */
function Tons({ t }: { t?: Value<"t"> }) {
  return t == null ? NULL_DISPLAY : <Unit value={t} decimals={2} />;
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
  /**
   * The `as AvionicsStatus | undefined` cast that used to be here hid the whole
   * migration: `useTelemetry` began answering with a `Reading` and the assertion
   * silenced it, so `s?.avionicsActive` was permanently undefined and the widget
   * read "NO AVIONICS" forever. A cast is a stronger blind spot than `unknown`,
   * because someone chose it.
   *
   * A GO/NO-GO is the definition of a judgement, so it is withheld rather than held:
   * a stale GO is the single worst thing this widget could draw.
   */
  const s = judgeable(useTelemetry("avionics.status")) as
    | AvionicsStatus
    | undefined;
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
            <BigReadout>
              <Tons t={s?.vesselMassTons} />
            </BigReadout>
            <ReadoutCaption>Vessel mass</ReadoutCaption>
          </div>
          <div>
            <BigReadout $tone={tone}>
              <Tons t={s?.controllableMassTons} />
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
