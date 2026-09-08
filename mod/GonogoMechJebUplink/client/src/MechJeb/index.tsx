import type {
  ActionDefinition,
  CommandStatus,
  ComponentProps,
  SystemUplinkHealth,
} from "@ksp-gonogo/sitrep-sdk";
import {
  registerComponent,
  useActionInput,
  useCommand,
  useStream,
  useTelemetry,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  Panel,
  Section,
  type Severity,
  Text,
  usePanelDelay,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import { useId, useState } from "react";
import { MECHJEB } from "../uplink";

/**
 * MechJeb: a delayed-command CONTROL surface rather than a telemetry readout,
 * because MechJeb's own readouts are all derivable from what the stream already
 * carries. Three remote-autopilot
 * commands (engage ascent autopilot, execute the next maneuver node, land at
 * the selected target) dispatched through the app's command layer
 * (`useCommand`) and gated on the signal delay: each button reflects its own
 * command lifecycle (idle → commanding/awaiting-reply → confirmed | rejected |
 * no-reply) exactly like `LandingStatus`'s gear/brakes rows.
 *
 * Co-located with the `GonogoMechJebUplink` mod
 * (`mod/GonogoMechJebUplink/MechJebUplink.cs`), which HANDLES `mechjeb.*` by
 * direct-linking MechJeb2's own ascent-autopilot, node-executor and
 * landing-autopilot API. Command
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

/*
 * CommandStatus.phase to an operator-facing chip, in the delayed-command
 * vocabulary. `in-flight` is the dispatched-but-unconfirmed window: from the
 * operator's seat the command is in transit, awaiting reply across the delay.
 */
function commandChip(
  phase: CommandStatus["phase"],
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
    case "undelivered":
      // The link never came back and the command was still queued here, so it
      // reached no autopilot at all. Still `critical`, because the vessel is
      // not doing what was asked, but a different sentence from the one above:
      // "no reply" leaves an operator wondering whether MechJeb took it.
      return { severity: "critical", text: "not sent" };
    case "found":
      // The command reported above as "no reply" turned out to have arrived.
      // `info`, not `nominal`: it is the most interesting thing on an otherwise
      // quiet row, and the operator may have re-sent it in the meantime. Only
      // the phase reaches here, so the chip says the reversal and the rail says
      // what the reply actually was.
      return { severity: "info", text: "found" };
    case "idle":
      return undefined; // nothing dispatched yet, so nothing to report
  }
  // Deliberately no `default`. A widened `phase: string` plus a catch-all
  // cannot notice a new phase, so one arrives as a silently missing chip rather
  // than a compile error. Assigning to `never` makes the next one fail the
  // typecheck here instead.
  const unhandled: never = phase;
  return unhandled;
}

/**
 * Whether MechJeb2 itself is reachable, off the uplink roster rather than any
 * topic of this Uplink's own: which MechJeb is installed is the identity of a
 * file on the operator's machine, and the roster is already where an Uplink
 * says whether the thing it depends on is usable. `MechJebUplink.Health()`
 * reports Unavailable with the version guard's reason whenever MechJeb2 is
 * absent or its API drifted, and registers no command handlers at all in that
 * state, so all three buttons below are inert.
 *
 * <p><b>An unread roster is not an unavailable uplink.</b> Only a roster that
 * ARRIVED and named this Uplink unavailable returns a reason here; before that
 * the answer is null and the commands stay live, because a press that turns out
 * to be refused says so honestly and a disabled button on no evidence does not.</p>
 */
function unavailableReason(
  roster: SystemUplinkHealth | undefined,
): string | null {
  const entry = roster?.uplinks.find((u) => u.id === MECHJEB.id);
  if (entry == null || entry.health.state !== "unavailable") {
    return null;
  }
  return (
    entry.health.detail ??
    entry.reason ??
    "MechJeb2 is not reachable from the mod."
  );
}

function CommandRow({
  label,
  phase,
  disabled,
  onFire,
}: Readonly<{
  label: string;
  phase: CommandStatus["phase"];
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
  //
  // Read straight off the Topic, with no cast: the payload declares
  // `oneWaySeconds` as a `Value<"s">`, and it arrives as one. Asserting it was
  // a bare number and re-wrapping it in `value("s", ...)` built a value whose
  // magnitude was an object, which every formatter renders as the null dash, so
  // a Duna-distance link read as no delay model at all.
  const delay = useTelemetry("comms.delay");
  const oneWay =
    delay.state === "observed" ? delay.value.oneWaySeconds : undefined;

  const unavailable = unavailableReason(
    useStream<SystemUplinkHealth>("system.uplinkHealth"),
  );

  // Held as the RAW string, not as a number, because `Number("")` is 0 and
  // `Number("what")` is NaN: parsing on every keystroke turns "the operator has
  // not given us an altitude" into "the operator asked for a 0 km orbit", and
  // the two are indistinguishable by the time they reach the wire. NaN reaches
  // it as JSON `null`, which the mod deserialises to 0 as well, so both spellings
  // of an unread field arrive as a confident number MechJeb will fly to.
  const [altitudeText, setAltitudeText] = useState<string>(
    String(config?.defaultAscentAltitudeKm ?? DEFAULT_ASCENT_ALTITUDE_KM),
  );
  const altitudeInputId = useId();
  const altitudeNoteId = useId();

  // `undefined` is the third value: blank, non-numeric, zero and negative all
  // land here, and none of them is an orbit. The same bound the mod's own
  // `MechJebAscentGuard` refuses on, so the widget declines to send what the
  // Uplink would decline to fly.
  const parsedAltitude = Number(altitudeText);
  const altitudeKm =
    altitudeText.trim() !== "" &&
    Number.isFinite(parsedAltitude) &&
    parsedAltitude > 0
      ? parsedAltitude
      : undefined;

  // The refusals live in the fire functions rather than on the buttons alone,
  // because a bound serial or keyboard input reaches these directly and never
  // sees a `disabled` attribute.
  const fireEngage = () => {
    // Refusing to draw beats drawing a zero, and refusing to SEND beats sending
    // one: this is an autopilot engage, so the number is flown.
    if (altitudeKm == null || unavailable != null) return;
    void engage.send(
      { targetAltitudeKm: altitudeKm },
      { label: `Engage ascent to ${writeQuantity(value("km", altitudeKm))}` },
    );
  };
  const fireExecuteNode = () => {
    if (unavailable != null) return;
    void executeNode.send({}, { label: "Execute next node" });
  };
  const fireLand = () => {
    if (unavailable != null) return;
    void land.send({}, { label: "Land at target" });
  };

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
    <Panel
      panelTitle="MechJeb"
      sections={[
        /* The link caption qualifies every command below it rather than sitting
           beside one, so it spans the section grid. */
        <Section key="link" full>
          <Text tone="faint" size="xs">
            {oneWay != null
              ? `Remote autopilot (${writeQuantity(oneWay, { decimals: 1 })} one-way delay)`
              : "Remote autopilot"}
          </Text>
          {unavailable != null ? (
            <span role="status" aria-live="polite">
              <Badge severity="critical" size="sm">
                MECHJEB NOT REACHABLE
              </Badge>
              <Text tone="warn" size="xs">
                {unavailable}
              </Text>
            </span>
          ) : null}
        </Section>,
        <Section key="ascent" title="Ascent">
          <Cluster gap="sm">
            <label htmlFor={altitudeInputId}>Target altitude (km)</label>
            <input
              id={altitudeInputId}
              type="number"
              min={0}
              step={5}
              value={altitudeText}
              aria-invalid={altitudeKm == null ? true : undefined}
              aria-describedby={altitudeKm == null ? altitudeNoteId : undefined}
              onChange={(e) => setAltitudeText(e.target.value)}
            />
          </Cluster>
          {altitudeKm == null ? (
            <Text id={altitudeNoteId} tone="warn" size="xs">
              No target altitude read from the field, so there is nothing to
              engage to
            </Text>
          ) : null}
          <CommandRow
            label="Engage ascent autopilot"
            phase={engage.status.phase}
            disabled={altitudeKm == null || unavailable != null}
            onFire={fireEngage}
          />
        </Section>,
        <Section key="maneuvers" title="Maneuvers">
          <CommandRow
            label="Execute next node"
            phase={executeNode.status.phase}
            disabled={unavailable != null}
            onFire={fireExecuteNode}
          />
          <CommandRow
            label="Land at target"
            phase={land.status.phase}
            disabled={unavailable != null}
            onFire={fireLand}
          />
        </Section>,
      ]}
    />
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
