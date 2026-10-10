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
import type { TitledInstrument } from "./instrument";

/** What each state badge on an instrument row means, shown on hover and focus. */
const BADGE_MEANING = {
  data: "Holds science data that has not been transmitted or recovered",
  deployed: "The experiment has been run on this instrument",
  oneShot: "Can run once only, and cannot be reset",
  inoperable: "Cannot be run in its current state, so it offers no controls",
} as const;

export interface ScienceExperimentRowProps {
  /** The instrument this row renders. */
  instrument: TitledInstrument;
  /** The deploy command. Omit for a read-only listing: the control is then not rendered at all, never rendered inert. */
  deployCmd?: CommandButtonHandle;
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
 * whether it holds data) and the Deploy/Transmit controls. Reads no telemetry, so the same row draws a stock instrument and a
 * contributed one.
 */
export function ScienceExperimentRow({
  instrument,
  deployCmd,
  transmitCmd,
  onTransmitted,
  heldGrade,
}: Readonly<ScienceExperimentRowProps>) {
  const actions = (
    <Inline inset style={ACTION_SLOT}>
      {!instrument.inoperable &&
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
      {!instrument.inoperable && instrument.hasData && transmitCmd && (
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
      title={instrument.partTitle}
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
        {instrument.deployed && (
          <Tooltip text={BADGE_MEANING.deployed}>
            <Badge>DEPLOYED</Badge>
          </Tooltip>
        )}
        {!instrument.rerunnable && (
          <Tooltip text={BADGE_MEANING.oneShot}>
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
        {experimentName(instrument)}
        {instrument.dataKnown !== false &&
          ` · ${instrument.hasData ? "Holds data" : "No data"}`}
      </Text>
    </Card>
  );
}
