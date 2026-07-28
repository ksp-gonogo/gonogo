import type { ActionDefinition, ComponentProps } from "@ksp-gonogo/core";
import {
  registerComponent,
  useActionInput,
  useTelemetry,
} from "@ksp-gonogo/core";
import type { InFlightCommand } from "@ksp-gonogo/sitrep-client";
import { useCommand } from "@ksp-gonogo/sitrep-client";
import {
  Badge,
  type BadgeTone,
  Cluster,
  InFlightList,
  type InFlightListItem,
  Panel,
  PanelSubtitle,
  PanelTitle,
  Section,
  SectionTitle,
} from "@ksp-gonogo/ui-kit";
import { useId, useState } from "react";

/**
 * MechJeb: a delayed-command CONTROL surface (not a telemetry readout;
 * MechJeb's own readouts are derivable, see
 * `local_docs/kerbalism-RO-design-DECISIONS.md`). Three remote-autopilot
 * commands (engage ascent autopilot, execute the next maneuver node, land at
 * the selected target) dispatched through the app's command layer
 * (`useCommand`) and gated on the signal delay: each button reflects its own
 * command lifecycle (idle → commanding/awaiting-reply → confirmed | rejected |
 * no-reply) exactly like `LandingStatus`'s gear/brakes rows.
 *
 * This is the CLIENT command surface only. The mod-side MechJeb2-reflection
 * uplink that HANDLES `mechjeb.*` (alongside the planned GonogoAvionicsUplink
 * family) is a separate task; until it lands these commands dispatch and time
 * out to `no reply`, which the UX already renders honestly.
 */

type MechJebConfig = {
  /** Seed altitude (km) for the ascent-autopilot target input. */
  defaultAscentAltitudeKm: number;
};

const DEFAULT_ASCENT_ALTITUDE_KM = 100;

const mechjebActions = [
  {
    id: "engage-ascent",
    label: "Engage ascent autopilot",
    accepts: ["button"],
    description:
      "Commands the ascent autopilot to fly to the set target altitude.",
  },
  {
    id: "execute-node",
    label: "Execute next node",
    accepts: ["button"],
    description: "Commands execution of the next maneuver node.",
  },
  {
    id: "land-at-target",
    label: "Land at target",
    accepts: ["button"],
    description: "Commands an autopilot landing at the selected target.",
  },
] as const satisfies readonly ActionDefinition[];
export type MechJebActions = typeof mechjebActions;

// CommandStatus.phase → operator-facing chip, in the delayed-command
// vocabulary. `in-flight` is the dispatched-but-unconfirmed window: from the
// operator's seat the command is in transit / awaiting reply across the delay.
function commandChip(
  phase: string,
): { tone: BadgeTone; text: string } | undefined {
  switch (phase) {
    case "in-flight":
      return { tone: "warn", text: "awaiting reply" };
    case "confirmed":
      return { tone: "go", text: "confirmed" };
    case "failed":
      return { tone: "nogo", text: "rejected" };
    case "lost":
      return { tone: "nogo", text: "no reply" };
    default:
      return undefined; // idle, no chip
  }
}

/**
 * `InFlightCommand` (sitrep-client) -> `InFlightListItem` (ui-kit, vanilla-
 * safe): the reach leg counts down to reaching the craft, everything else
 * counts down to the reply: same mapping the kOS terminal's own
 * `useRouteCommands` -> `InFlightList` wiring uses.
 */
function toInFlightListItems(items: InFlightCommand[]): InFlightListItem[] {
  return items.map((item) => ({
    id: item.id,
    label: item.label || item.command,
    etaSeconds:
      item.predictedPhase === "in-transit"
        ? item.reachEtaSeconds
        : item.replyEtaSeconds,
    phase: item.predictedPhase,
  }));
}

function CommandRow({
  label,
  phase,
  disabled,
  onFire,
}: Readonly<{
  label: string;
  phase: string;
  disabled?: boolean;
  onFire: () => void;
}>) {
  const chip = commandChip(phase);
  return (
    <Cluster justify="between" gap="sm">
      <button
        type="button"
        onClick={onFire}
        disabled={disabled}
        aria-label={label}
      >
        {label}
      </button>
      <span role="status" aria-live="polite">
        {chip ? (
          <Badge tone={chip.tone} size="sm">
            {chip.text}
          </Badge>
        ) : null}
      </span>
    </Cluster>
  );
}

function MechJebComponent({ config }: Readonly<ComponentProps<MechJebConfig>>) {
  const engage = useCommand("mechjeb.engageAscentAutopilot");
  const executeNode = useCommand("mechjeb.executeNextNode");
  const land = useCommand("mechjeb.landAtTarget");

  const commsDelay = useTelemetry("comms.delay");
  const oneWay =
    commsDelay &&
    typeof commsDelay === "object" &&
    "oneWaySeconds" in commsDelay
      ? (commsDelay as { oneWaySeconds?: number }).oneWaySeconds
      : undefined;

  const [altitudeKm, setAltitudeKm] = useState<number>(
    config?.defaultAscentAltitudeKm ?? DEFAULT_ASCENT_ALTITUDE_KM,
  );
  const altitudeInputId = useId();

  const fireEngage = () =>
    void engage.send(
      { targetAltitudeKm: altitudeKm },
      { label: `Engage ascent to ${altitudeKm} km` },
    );
  const fireExecuteNode = () =>
    void executeNode.send({}, { label: "Execute next node" });
  const fireLand = () => void land.send({}, { label: "Land at target" });

  useActionInput<MechJebActions>({
    "engage-ascent": (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      fireEngage();
      return undefined;
    },
    "execute-node": (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      fireExecuteNode();
      return undefined;
    },
    "land-at-target": (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      fireLand();
      return undefined;
    },
  });

  return (
    <Panel>
      <PanelTitle>MechJeb</PanelTitle>
      <PanelSubtitle>
        {oneWay != null
          ? `Remote autopilot (${oneWay.toFixed(1)} s one-way delay)`
          : "Remote autopilot"}
      </PanelSubtitle>

      <Section>
        <SectionTitle>Ascent</SectionTitle>
        <Cluster gap="sm">
          <label htmlFor={altitudeInputId}>Target altitude (km)</label>
          <input
            id={altitudeInputId}
            type="number"
            min={0}
            step={5}
            value={altitudeKm}
            onChange={(e) => setAltitudeKm(Number(e.target.value))}
          />
        </Cluster>
        <CommandRow
          label="Engage ascent autopilot"
          phase={engage.status.phase}
          onFire={fireEngage}
        />
      </Section>

      <Section>
        <SectionTitle>Maneuvers</SectionTitle>
        <CommandRow
          label="Execute next node"
          phase={executeNode.status.phase}
          onFire={fireExecuteNode}
        />
        <InFlightList
          items={toInFlightListItems(executeNode.inFlight)}
          ariaLabel="Execute next node: in flight"
        />
        <CommandRow
          label="Land at target"
          phase={land.status.phase}
          onFire={fireLand}
        />
      </Section>
    </Panel>
  );
}

registerComponent<MechJebConfig>({
  id: "mechjeb",
  name: "MechJeb",
  description:
    "Remote MechJeb autopilot control (engage ascent, execute next node, land at target) dispatched over the delayed-command path with per-command in-flight state.",
  tags: ["control"],
  defaultSize: { w: 5, h: 7 },
  minSize: { w: 3, h: 5 },
  component: MechJebComponent,
  // Command-only widget: MechJeb readouts are derivable, so the only READ is
  // comms.delay (for the delay-context subtitle). The mechjeb.* COMMAND topics
  // route through the command layer, not dataRequirements.
  dataRequirements: ["comms.delay"],
  defaultConfig: { defaultAscentAltitudeKm: DEFAULT_ASCENT_ALTITUDE_KM },
  actions: mechjebActions,
  requires: ["flight"],
});

export { MechJebComponent };
