import type { HeldGrade } from "@ksp-gonogo/sitrep-client";
import type { CommandReply, ScienceTransmission } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Card,
  CommandButton,
  type CommandButtonHandle,
  HeldBadge,
  Inline,
  Text,
  Tooltip,
} from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import type { TitledInstrument } from "./instrument";

/** What each state badge on an instrument row means, shown on hover and focus. */
const BADGE_MEANING = {
  data: "Holds science data that has not been transmitted or recovered",
  deployed: "The experiment has been run on this instrument",
  oneShot: "Can run once only",
  oneShotResettable: "Can run once only until it is reset",
  oneShotFinal: "Can run once only, and cannot be reset",
  inoperable: "Cannot be run in its current state, so it offers no controls",
  running: "Switched on and generating science",
  runningIdle: "Switched on, but not generating science right now",
  stopped: "Switched off",
} as const;

export interface ScienceExperimentRowProps {
  /** The instrument this row renders. */
  instrument: TitledInstrument;
  /** The deploy command. Omit for a read-only listing: the control is then not rendered at all, never rendered inert. */
  deployCmd?: CommandButtonHandle;
  /** The start command for a continuous instrument. Omit for a read-only listing. */
  startCmd?: CommandButtonHandle<CommandReply<"science.experiment.start">>;
  /** The stop command for a continuous instrument. Omit for a read-only listing. */
  stopCmd?: CommandButtonHandle<CommandReply<"science.experiment.stop">>;
  /** The transmit command. Omit for a read-only listing. */
  transmitCmd?: CommandButtonHandle<
    CommandReply<"science.experiment.transmit">
  >;
  /** Receives the transmission a confirmed Transmit started, when the backend said what it sent. */
  onTransmitted?: (transmission: ScienceTransmission) => void;
  /**
   * The grade of the instrument list when it is held, undefined while it is
   * current. It marks the row; the controls stay live, because each command
   * refuses an instrument no longer in the state it needs.
   */
  heldGrade?: HeldGrade;
  /** True where the row sits under its part's heading: the card is then titled by its experiment and does not repeat the part. */
  underPart?: boolean;
}

/** The experiment a card is for, by its title where the wire has one. */
function experimentName(instrument: TitledInstrument): string {
  return instrument.expTitle || instrument.expId || "Unknown experiment";
}

/** Holds a badge's height whether or not the instrument has any state to badge. */
const BADGE_SLOT = { minHeight: "var(--control-height)" } as const;

/** Holds the controls' height whether or not this instrument offers any, so every card is the same height. */
const ACTION_SLOT = { minHeight: "var(--control-height)" } as const;

/**
 * A single science-instrument card. Every card has the same four slots in the
 * same places: the part's name, state badges, a data line (the experiment and
 * whether it holds data) and the Deploy/Transmit controls, or Start/Stop for a
 * continuous instrument. Reads no telemetry, so the same row draws a stock
 * instrument and a contributed one.
 */
export function ScienceExperimentRow({
  instrument,
  deployCmd,
  startCmd,
  stopCmd,
  transmitCmd,
  onTransmitted,
  heldGrade,
  underPart,
}: Readonly<ScienceExperimentRowProps>) {
  const continuous = instrument.continuous === true;
  // The reply to one press that found the instrument already where it was sent; it holds only while the reading agrees.
  const [unchanged, setUnchanged] = useState<{
    text: string;
    whileRunning: boolean;
  } | null>(null);
  const noteIfUnchanged =
    (started: boolean) => (reply: CommandReply<"science.experiment.start">) => {
      if (reply?.payload?.changed === false)
        setUnchanged({
          text: started ? "Already running" : "Already stopped",
          whileRunning: started,
        });
    };
  const actions = (
    <Inline inset style={ACTION_SLOT}>
      {continuous &&
        !instrument.inoperable &&
        instrument.running === false &&
        startCmd && (
          <CommandButton
            size="sm"
            handle={startCmd}
            args={{ partId: instrument.partId, experimentId: instrument.expId }}
            commandLabel={`Start ${experimentName(instrument)}`}
            label="Start"
            pendingLabel="Starting..."
            onConfirmed={noteIfUnchanged(true)}
          />
        )}
      {continuous &&
        !instrument.inoperable &&
        instrument.running === true &&
        stopCmd && (
          <CommandButton
            size="sm"
            handle={stopCmd}
            args={{ partId: instrument.partId, experimentId: instrument.expId }}
            commandLabel={`Stop ${experimentName(instrument)}`}
            label="Stop"
            pendingLabel="Stopping..."
            onConfirmed={noteIfUnchanged(false)}
          />
        )}
      {!continuous &&
        !instrument.inoperable &&
        !instrument.deployed &&
        !instrument.hasData &&
        deployCmd && (
          <CommandButton
            size="sm"
            handle={deployCmd}
            args={{ partId: instrument.partId }}
            commandLabel={`Deploy ${instrument.partTitle}`}
            label="Deploy"
            pendingLabel="Deploying..."
          />
        )}
      {!continuous &&
        !instrument.inoperable &&
        instrument.hasData &&
        transmitCmd && (
          <CommandButton
            size="sm"
            handle={transmitCmd}
            args={{ partId: instrument.partId }}
            commandLabel={`Transmit ${instrument.partTitle}`}
            label="Transmit"
            confirmLabel="Confirm transmit"
            pendingLabel="Transmitting..."
            onConfirmed={(reply) => {
              if (reply?.payload) onTransmitted?.(reply.payload);
            }}
          />
        )}
    </Inline>
  );
  return (
    <Card
      as="li"
      title={underPart ? experimentName(instrument) : instrument.partTitle}
      tone={
        instrument.inoperable ? "nogo" : instrument.hasData ? "go" : undefined
      }
      footer={actions}
    >
      <Inline wrap style={BADGE_SLOT}>
        {instrument.hasData && (
          <Tooltip text={BADGE_MEANING.data}>
            <Badge tone="go">DATA</Badge>
          </Tooltip>
        )}
        {continuous && instrument.running === true && (
          <Tooltip
            text={
              instrument.producing === false
                ? BADGE_MEANING.runningIdle
                : BADGE_MEANING.running
            }
          >
            <Badge tone={instrument.producing === false ? "caution" : "go"}>
              RUNNING
            </Badge>
          </Tooltip>
        )}
        {continuous && instrument.running === false && (
          <Tooltip text={BADGE_MEANING.stopped}>
            <Badge>STOPPED</Badge>
          </Tooltip>
        )}
        {!continuous && instrument.deployed && (
          <Tooltip text={BADGE_MEANING.deployed}>
            <Badge>DEPLOYED</Badge>
          </Tooltip>
        )}
        {/* An experiment whose reusability is unknown is not one-shot, and a continuous one is not run once. */}
        {!continuous &&
          !instrument.rerunnable &&
          instrument.rerunnableKnown !== false && (
            <Tooltip
              text={
                instrument.resettable === true
                  ? BADGE_MEANING.oneShotResettable
                  : instrument.resettable === false
                    ? BADGE_MEANING.oneShotFinal
                    : BADGE_MEANING.oneShot
              }
            >
              <Badge>ONE-SHOT</Badge>
            </Tooltip>
          )}
        {instrument.inoperable && (
          <Tooltip text={BADGE_MEANING.inoperable}>
            <Badge tone="nogo">INOPERABLE</Badge>
          </Tooltip>
        )}
        {heldGrade !== undefined && (
          <HeldBadge grade={heldGrade} subject={instrument.partTitle} />
        )}
      </Inline>
      <Text level="muted" size="xs">
        {!underPart && experimentName(instrument)}
        {instrument.dataKnown !== false &&
          `${underPart ? "" : " · "}${instrument.hasData ? "Holds data" : "No data"}`}
      </Text>
      {continuous && instrument.running === true && instrument.runIssue && (
        <Text level="muted" size="xs">
          {instrument.runIssue}
        </Text>
      )}
      <Text level="muted" size="xs" role="status" aria-live="polite">
        {unchanged !== null && unchanged.whileRunning === instrument.running
          ? unchanged.text
          : null}
      </Text>
    </Card>
  );
}
