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
  Card,
  Cluster,
  CommandButton,
  Field,
  FieldLabel,
  Grid,
  Input,
  magnitudeOf,
  SectionTitle,
  Select,
  Stack,
  SubjectHeading,
  Text,
  Unit,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import { useCallback, useId, useState } from "react";
import type {
  RealAntennasAntennaChain,
  RealAntennasAntennaState,
  RealAntennasTargetStepArgs,
} from "../__generated__/contract";
import { REALANTENNAS } from "../uplink";
import { AntennaChain } from "./chain";
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
  /** What the craft reports this antenna holding as a fallback chain, if anything. */
  chain: RealAntennasAntennaChain | undefined;
  bodies: readonly string[];
  vessels: readonly { id: string; name: string }[];
}

function AntennaCard({ antenna, chain, bodies, vessels }: AntennaCardProps) {
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

  /**
   * The chain the operator is composing, held here rather than in the chain
   * block because it is built out of the aim controls above: staging an entry is
   * "the target I have just described, as a fallback" rather than a second set
   * of fields saying the same thing twice.
   */
  const [draft, setDraft] = useState<RealAntennasTargetStepArgs[]>([]);
  const composed = (): RealAntennasTargetStepArgs => ({
    mode,
    vesselId: vesselId || undefined,
    bodyName: bodyName || undefined,
    latitude: numberOf(latitude),
    longitude: numberOf(longitude),
    altitude: numberOf(altitude),
    azimuth: numberOf(azimuth),
    elevation: numberOf(elevation),
    forward: numberOf(forward),
  });
  const stage = () => setDraft((entries) => [...entries, composed()]);
  const unstage = () => setDraft((entries) => entries.slice(0, -1));
  const clearDraft = useCallback(() => setDraft([]), []);

  const unlocked = antenna.availableTargetModes ?? [];
  const modeIsUnlocked = (id: ModeId): boolean => unlocked.includes(id);
  const antennaName = antenna.name ?? antenna.antennaId;

  /**
   * Both flags carry three answers, and every branch below tests for the one it
   * means rather than for truthiness. `steerable` is null when RealAntennas
   * would not say what shape this antenna is: that is neither a dish nor an
   * omni, and `antenna.steerable ? ... : "Omni"` called it an omni. `targeted`
   * is null on the same terms.
   */
  const isOmni = antenna.steerable === false;
  const steerableUnread = antenna.steerable == null;

  return (
    <Card>
      <Stack gap="sm">
        {/*
          Only the omni is labelled. The targeting controls below already mark
          a dish as one, so a badge saying so repeated what the card shows; the
          omni has no controls, and nothing else on it says why. An antenna
          whose shape could not be read has no controls either, and gets no
          badge for the same reason the dish gets none: the line that replaces
          its controls already says what happened, and saying it twice makes
          two facts out of one.
        */}
        <SubjectHeading
          status={
            isOmni ? (
              <Text size="xs" tone="muted" style={LABEL_STYLE}>
                Omni
              </Text>
            ) : null
          }
        >
          <Text size="sm" tone="default">
            {antennaName}
          </Text>
        </SubjectHeading>

        {/* The antenna's own facts. Tech level sits here rather than beside the
            name: it is a property of the hardware, and the heading's status slot
            is for what an antenna is currently doing. */}
        <Grid cols="auto 1fr" gap="lg" rowGap="sm" align="baseline">
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
          {!isOmni ? (
            <>
              <Text size="xs" tone="muted" style={LABEL_STYLE}>
                Aimed at
              </Text>
              {/*
                Three readings off one field. "Not aimed" is a statement about
                the dish and is reserved for the antenna that actually said so;
                an unread flag gets its own line rather than borrowing that one.
              */}
              <Text
                size="sm"
                tone={antenna.targeted === true ? "default" : "muted"}
              >
                {antenna.targeted === true
                  ? antenna.targetLabel
                  : antenna.targeted === false
                    ? "Not aimed"
                    : "Could not be read"}
              </Text>
            </>
          ) : null}
          {!isOmni && magnitudeOf(antenna.cone10Db) !== null ? (
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

        {steerableUnread ? (
          /*
            No controls, and a line saying why there are none. The mod refuses
            both commands for this antenna on the same grounds, so a live AIM
            button would be a press that provably goes nowhere; an inert-looking
            card beside a stated reason is honest where a live-looking one that
            swallows the press is not.
          */
          <Text size="xs" tone="muted">
            RealAntennas would not say whether this antenna can be aimed, so the
            targeting controls are held.
          </Text>
        ) : null}

        {antenna.steerable === true ? (
          /*
            Two groups, not one run: the fields sit tight to each other and the
            actions a step further out. A press that lands as close to the last
            field as the fields do to one another reads as another field.
          */
          <Stack gap="lg">
            <Stack gap="sm">
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
                <Cluster gap="md" wrap>
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
                <Cluster gap="md" wrap>
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
                <Cluster gap="md" wrap>
                  <Field>
                    <FieldLabel htmlFor={`${fieldId}-fwd`}>
                      Prograde °
                    </FieldLabel>
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
            </Stack>

            <Cluster gap="md" wrap justify="start">
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

            <AntennaChain
              antennaId={antenna.antennaId}
              antennaName={antennaName}
              chain={chain}
              draft={draft}
              onStage={stage}
              onUnstage={unstage}
              onSent={clearDraft}
            />
          </Stack>
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
  const chainsReading = useTelemetry("realantennas.antennaChains");
  const bodiesReading = useTelemetry("system.bodies");
  const vesselsReading = useTelemetry("system.vessels");

  const antennas =
    antennasReading.state === "observed" ? antennasReading.value : undefined;
  if (!antennas || antennas.length === 0) return null;

  /*
    Joined by antenna address rather than by position. The chain channel carries
    only the antennas that HAVE a chain, which is usually none of them, so the
    two arrays do not correspond index for index and never did.
  */
  const chains = new Map(
    (chainsReading.state === "observed" ? chainsReading.value : []).map(
      (chain) => [chain.antennaId, chain],
    ),
  );

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
    <Stack gap="sm" aria-label="Antenna targeting">
      <SectionTitle>Antenna targeting</SectionTitle>
      {antennas.map((antenna) => (
        <AntennaCard
          key={antenna.antennaId}
          antenna={antenna}
          chain={chains.get(antenna.antennaId)}
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
  channels: [
    "realantennas.antennas",
    "realantennas.antennaChains",
    "system.bodies",
    "system.vessels",
  ],
  component: CommSignalAntennaTargets,
  owner: REALANTENNAS,
});

export { CommSignalAntennaTargets };
