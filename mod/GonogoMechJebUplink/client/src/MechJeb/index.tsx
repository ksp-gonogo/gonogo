import type {
  ActionDefinition,
  ComponentProps,
  Reading,
} from "@ksp-gonogo/sitrep-sdk";
import {
  registerComponent,
  useActionInput,
  useCommand,
  useTelemetry,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  Panel,
  Section,
  SectionTitle,
  type Severity,
  usePanelDelay,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { useId, useState } from "react";
import { MECHJEB } from "../uplink";

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
 * Co-located with the `GonogoMechJebUplink` mod
 * (`mod/GonogoMechJebUplink/MechJebUplink.cs`), which HANDLES `mechjeb.*` by
 * direct-linking MechJeb2's own ascent-autopilot/node-executor/landing-
 * autopilot API (see `local_docs/design/mechjeb-decompile-lock.md`). Command
 * handling is fail-soft: MechJeb2 absent, or an API drift the version guard
 * catches, takes the mod-side uplink inert and these commands degrade to the
 * same `no reply` the UX already renders honestly.
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
/**
 * The value a VERDICT may be drawn from: current, or modelled forward to the frame.
 * A stale reading gives nothing, because a judgement cannot be dated: the operator
 * reads a band or a pill as the situation NOW.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

function commandChip(
  phase: string,
): { severity: Severity; text: string } | undefined {
  switch (phase) {
    case "in-flight":
      return { severity: "warning", text: "awaiting reply" };
    case "confirmed":
      return { severity: "nominal", text: "confirmed" };
    case "failed":
      return { severity: "critical", text: "rejected" };
    case "refused":
      // The game evaluated the command and said no, which is a different
      // thing from the machinery breaking above: MechJeb not installed at the
      // version the guard wants, no vessel, wrong mode. Nothing was broken and
      // a retry changes nothing until the situation does.
      return { severity: "critical", text: "refused" };
    case "lost":
      return { severity: "critical", text: "no reply" };
    default:
      return undefined; // idle, no chip
  }
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
          <Badge severity={chip.severity} size="sm">
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
  usePanelDelay(engage);
  usePanelDelay(executeNode);
  usePanelDelay(land);

  // The delay sets how long a command takes to arrive, so it is a judgement: a
  // held value would time an uplink against a link that has since changed.
  const commsDelay = judgeable(useTelemetry("comms.delay"));
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
      { label: `Engage ascent to ${writeQuantity(value("km", altitudeKm))}` },
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
    <Panel panelTitle="MechJeb">
      <div
        style={{
          fontSize: "var(--font-size-xs)",
          color: "var(--color-text-faint)",
          marginBottom: "var(--space-8)",
        }}
      >
        {oneWay != null
          ? `Remote autopilot (${writeQuantity(value("s", oneWay), { decimals: 1 })} one-way delay)`
          : "Remote autopilot"}
      </div>
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
  owner: MECHJEB,
});

export { MechJebComponent };
