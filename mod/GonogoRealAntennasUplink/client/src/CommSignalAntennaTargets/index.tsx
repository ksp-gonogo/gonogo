/**
 * The antenna-targeting section: one card per antenna on the active vessel,
 * composed into the base CommSignal widget's universal `comm-signal.sections`
 * seat beside the link-budget section already there.
 *
 * Reads `realantennas.antennas` and sends `realantennas.antenna.target` /
 * `.targetHome`. Presence-gated on `realantennas.available`, so an install
 * without RealAntennas never sees it.
 *
 * Targeting is per ANTENNA, never per vessel: RealAntennas stores one target per
 * antenna with no arbitration between them, and the link solver treats two
 * dishes aimed two ways as two candidate links. Hence a card each, rather than
 * one control for the craft.
 */

import {
  registerAugment,
  useCommand,
  useTelemetry,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Card,
  Cluster,
  CommandButton,
  Field,
  FieldLabel,
  Grid,
  Input,
  magnitudeOf,
  Select,
  Stack,
  SubjectHeading,
  Text,
  Unit,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import { useId, useState } from "react";
import type { RealAntennasAntennaState } from "../__generated__/contract";
import { REALANTENNAS } from "../uplink";
// Side-effect imports: the Topic and command registrations this augment reads
// and sends through.
import "../commands";
import "../topics";

/**
 * Every mode RealAntennas declares, in its own order.
 *
 * Rendered in full rather than filtered down to what an antenna has earned: a
 * mode the tech level has not reached appears DISABLED and labelled, because a
 * silently absent option looks like a mode this mod does not support.
 */
const MODES = [
  { id: "BodyCenter", label: "Body centre" },
  { id: "Vessel", label: "Vessel" },
  { id: "BodyLatLonAlt", label: "Surface point" },
  { id: "AzEl", label: "Azimuth / elevation" },
  { id: "OrbitRelative", label: "Orbit relative" },
] as const;

type ModeId = (typeof MODES)[number]["id"];

const LABEL_STYLE = {
  letterSpacing: "0.1em",
  textTransform: "uppercase" as const,
};

/** A numeric form field, parsed once at the edge so the args are numbers or absent. */
function numberOf(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

interface AntennaCardProps {
  antenna: RealAntennasAntennaState;
  bodies: readonly string[];
  vessels: readonly { id: string; name: string }[];
}

function AntennaCard({ antenna, bodies, vessels }: AntennaCardProps) {
  const fieldId = useId();
  const [mode, setMode] = useState<ModeId>("BodyCenter");
  const [bodyName, setBodyName] = useState("");
  const [vesselId, setVesselId] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [altitude, setAltitude] = useState("");
  const [azimuth, setAzimuth] = useState("");
  const [elevation, setElevation] = useState("");
  const [forward, setForward] = useState("");

  const target = useCommand("realantennas.antenna.target");
  const targetHome = useCommand("realantennas.antenna.targetHome");
  usePanelDelay(target);
  usePanelDelay(targetHome);

  const unlocked = antenna.availableTargetModes ?? [];
  const modeIsUnlocked = (id: ModeId): boolean => unlocked.includes(id);
  const antennaName = antenna.name ?? antenna.antennaId;

  return (
    <Card>
      <Stack gap="xs">
        {/*
          A badge for the dish, plain text for the omni. Both are facts about the
          hardware rather than states, and every severity a `Badge` can carry
          paints one: green read as "this antenna is good" for one that simply
          cannot be aimed.
        */}
        <SubjectHeading
          status={
            antenna.steerable ? (
              <Badge severity="info">Dish</Badge>
            ) : (
              <Text size="xs" tone="muted" style={LABEL_STYLE}>
                Omni
              </Text>
            )
          }
        >
          <Text size="sm" tone="default">
            {antennaName}
          </Text>
        </SubjectHeading>

        {/* The antenna's own facts. Tech level sits here rather than beside the
            name: it is a property of the hardware, not a state of it, and the
            heading's status slot is for states. */}
        <Grid cols="auto 1fr" gap="md" rowGap="xs" align="baseline">
          {antenna.techLevel != null ? (
            <>
              <Text size="xs" tone="muted" style={LABEL_STYLE}>
                Tech level
              </Text>
              <Text size="sm" tone="default">
                <Unit value={antenna.techLevel} />
              </Text>
            </>
          ) : null}
          {antenna.steerable ? (
            <>
              <Text size="xs" tone="muted" style={LABEL_STYLE}>
                Aimed at
              </Text>
              <Text size="sm" tone={antenna.targeted ? "default" : "muted"}>
                {antenna.targeted ? antenna.targetLabel : "Not aimed"}
              </Text>
            </>
          ) : null}
          {antenna.steerable && magnitudeOf(antenna.cone10Db) !== null ? (
            <>
              <Text size="xs" tone="muted" style={LABEL_STYLE}>
                Beam
              </Text>
              <Text size="sm" tone="default">
                <Unit value={antenna.cone10Db} />
              </Text>
            </>
          ) : null}
        </Grid>

        {antenna.steerable ? (
          <>
            <Field>
              <FieldLabel htmlFor={`${fieldId}-mode`}>Mode</FieldLabel>
              <Select
                id={`${fieldId}-mode`}
                value={mode}
                onChange={(e) => setMode(e.target.value as ModeId)}
              >
                {MODES.map((m) => (
                  <option
                    key={m.id}
                    value={m.id}
                    disabled={!modeIsUnlocked(m.id)}
                  >
                    {modeIsUnlocked(m.id) ? m.label : `${m.label} (locked)`}
                  </option>
                ))}
              </Select>
            </Field>

            {mode === "Vessel" ? (
              <Field>
                <FieldLabel htmlFor={`${fieldId}-vessel`}>Vessel</FieldLabel>
                <Select
                  id={`${fieldId}-vessel`}
                  value={vesselId}
                  onChange={(e) => setVesselId(e.target.value)}
                >
                  <option value="">Choose a target</option>
                  {vessels.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            {mode === "BodyCenter" || mode === "BodyLatLonAlt" ? (
              <Field>
                <FieldLabel htmlFor={`${fieldId}-body`}>Body</FieldLabel>
                <Select
                  id={`${fieldId}-body`}
                  value={bodyName}
                  onChange={(e) => setBodyName(e.target.value)}
                >
                  <option value="">Home</option>
                  {bodies.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            {mode === "BodyLatLonAlt" ? (
              <Cluster gap="sm" wrap>
                <Field>
                  <FieldLabel htmlFor={`${fieldId}-lat`}>Lat °</FieldLabel>
                  <Input
                    id={`${fieldId}-lat`}
                    inputMode="decimal"
                    value={latitude}
                    onChange={(e) => setLatitude(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${fieldId}-lon`}>Lon °</FieldLabel>
                  <Input
                    id={`${fieldId}-lon`}
                    inputMode="decimal"
                    value={longitude}
                    onChange={(e) => setLongitude(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${fieldId}-alt`}>Alt m</FieldLabel>
                  <Input
                    id={`${fieldId}-alt`}
                    inputMode="decimal"
                    value={altitude}
                    onChange={(e) => setAltitude(e.target.value)}
                  />
                </Field>
              </Cluster>
            ) : null}

            {mode === "AzEl" ? (
              <Cluster gap="sm" wrap>
                <Field>
                  <FieldLabel htmlFor={`${fieldId}-az`}>Az °</FieldLabel>
                  <Input
                    id={`${fieldId}-az`}
                    inputMode="decimal"
                    value={azimuth}
                    onChange={(e) => setAzimuth(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${fieldId}-el`}>El °</FieldLabel>
                  <Input
                    id={`${fieldId}-el`}
                    inputMode="decimal"
                    value={elevation}
                    onChange={(e) => setElevation(e.target.value)}
                  />
                </Field>
              </Cluster>
            ) : null}

            {mode === "OrbitRelative" ? (
              <Cluster gap="sm" wrap>
                <Field>
                  <FieldLabel htmlFor={`${fieldId}-fwd`}>Prograde °</FieldLabel>
                  <Input
                    id={`${fieldId}-fwd`}
                    inputMode="decimal"
                    value={forward}
                    onChange={(e) => setForward(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${fieldId}-oel`}>El °</FieldLabel>
                  <Input
                    id={`${fieldId}-oel`}
                    inputMode="decimal"
                    value={elevation}
                    onChange={(e) => setElevation(e.target.value)}
                  />
                </Field>
              </Cluster>
            ) : null}

            <Cluster gap="sm" wrap justify="start">
              {/* Armed: a slew is a signal to the craft and the dish stops
                  hearing whatever it was on when it moves. */}
              <CommandButton
                size="sm"
                handle={target}
                args={{
                  antennaId: antenna.antennaId,
                  mode,
                  vesselId: vesselId || undefined,
                  bodyName: bodyName || undefined,
                  latitude: numberOf(latitude),
                  longitude: numberOf(longitude),
                  altitude: numberOf(altitude),
                  azimuth: numberOf(azimuth),
                  elevation: numberOf(elevation),
                  forward: numberOf(forward),
                }}
                commandLabel={`Aim ${antennaName}`}
                label="AIM"
                confirmLabel="CONFIRM AIM"
                pendingLabel="Aiming..."
              />
              <CommandButton
                size="sm"
                handle={targetHome}
                args={{ antennaId: antenna.antennaId }}
                commandLabel={`Aim ${antennaName} at the home body`}
                label="HOME"
                confirmLabel="CONFIRM HOME"
                pendingLabel="Aiming..."
              />
            </Cluster>
          </>
        ) : null}
      </Stack>
    </Card>
  );
}

/**
 * The section. Renders nothing when the craft reports no antennas, so a vessel
 * without one keeps CommSignal exactly as it was.
 */
function CommSignalAntennaTargets() {
  const antennasReading = useTelemetry("realantennas.antennas");
  const bodiesReading = useTelemetry("system.bodies");
  const vesselsReading = useTelemetry("system.vessels");

  const antennas =
    antennasReading.state === "observed" ? antennasReading.value : undefined;
  if (!antennas || antennas.length === 0) return null;

  const bodies =
    bodiesReading.state === "observed"
      ? bodiesReading.value.bodies
          .map((b) => b.name)
          .filter((n): n is string => !!n)
      : [];
  const vessels =
    vesselsReading.state === "observed"
      ? vesselsReading.value.vessels.map((v) => ({
          id: v.vesselId,
          name: v.name || v.vesselId,
        }))
      : [];

  return (
    <Stack gap="xs" aria-label="Antenna targeting">
      <Text size="xs" tone="muted" style={LABEL_STYLE}>
        Antenna targeting
      </Text>
      {/* The cost, once. An unaimed dish takes no pointing loss at all; an
          aimed one loses the link outright once the far end leaves the beam. */}
      <Text size="xs" tone="muted">
        Unaimed, a dish points everywhere free. Aimed, the link drops outside
        its beam.
      </Text>
      {antennas.map((antenna) => (
        <AntennaCard
          key={antenna.antennaId}
          antenna={antenna}
          bodies={bodies}
          vessels={vessels}
        />
      ))}
    </Stack>
  );
}

registerAugment({
  id: "realantennas-comm-signal-antenna-targets",
  augments: "comm-signal.sections",
  requires: "realantennas",
  channels: ["realantennas.antennas", "system.bodies", "system.vessels"],
  component: CommSignalAntennaTargets,
  owner: REALANTENNAS,
});

export { CommSignalAntennaTargets };
