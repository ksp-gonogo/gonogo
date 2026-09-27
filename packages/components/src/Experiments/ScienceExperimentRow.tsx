import type { StaleGrade } from "@ksp-gonogo/sitrep-client";
import type { CommandReply, ScienceTransmission } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  CommandButton,
  type CommandButtonHandle,
  formatStreamStatus,
  Inline,
  Row,
  RowName,
  severityFromStreamStatus,
} from "@ksp-gonogo/ui-kit";
import type { Instrument } from "./instrument";

export interface ScienceExperimentRowProps {
  /** The instrument this row renders. */
  instrument: Instrument;
  /** The deploy command. Omit for a read-only listing: the control is then not rendered at all, never rendered inert. */
  deployCmd?: CommandButtonHandle;
  /** The transmit command. Omit for a read-only listing. */
  transmitCmd?: CommandButtonHandle<
    CommandReply<"science.experiment.transmit">
  >;
  /** Receives the transmission a confirmed Transmit started, when the backend said what it sent. */
  onTransmitted?: (transmission: ScienceTransmission) => void;
  /**
   * The grade of the instrument list when it is no longer current, undefined
   * while it is. It disables the controls as well as marking the badges: a
   * Transmit against a held row can spend a one-shot on an instrument already emptied.
   */
  heldGrade?: StaleGrade;
}

/**
 * A single science-instrument row: name, state badges and the Deploy/Transmit
 * controls. Reads no telemetry, so the same row draws a stock instrument and a
 * contributed one.
 */
export function ScienceExperimentRow({
  instrument,
  deployCmd,
  transmitCmd,
  onTransmitted,
  heldGrade,
}: Readonly<ScienceExperimentRowProps>) {
  const notCurrent = heldGrade !== undefined;
  const heldReason = `${instrument.partTitle}: instrument state is no longer current`;
  return (
    // Wraps, because a row can carry all four badges at once.
    <Row wrap>
      <RowName title={instrument.partTitle}>{instrument.partTitle}</RowName>
      <Inline wrap>
        {instrument.hasData && <Badge severity="nominal">DATA</Badge>}
        {instrument.deployed && <Badge>DEPLOYED</Badge>}
        {!instrument.rerunnable && <Badge>ONE-SHOT</Badge>}
        {instrument.inoperable && <Badge severity="critical">INOPERABLE</Badge>}
        {/* A plain `Badge`, not the live-region `StreamStatusBadge`: many rows going held at once is one event. */}
        {heldGrade !== undefined && (
          <Badge
            severity={severityFromStreamStatus(heldGrade)}
            title={heldReason}
          >
            {formatStreamStatus(heldGrade)}
          </Badge>
        )}
      </Inline>
      {/* Hidden rather than disabled: the INOPERABLE badge already says why. */}
      {!instrument.inoperable && (
        <Inline inset>
          {!instrument.deployed && !instrument.hasData && deployCmd && (
            <CommandButton
              size="sm"
              handle={deployCmd}
              args={{ partId: instrument.partId }}
              commandLabel={`Deploy ${instrument.partTitle}`}
              label="Deploy"
              pendingLabel="Deploying..."
              disabled={notCurrent}
              title={notCurrent ? heldReason : undefined}
            />
          )}
          {instrument.hasData && transmitCmd && (
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
              disabled={notCurrent}
              title={notCurrent ? heldReason : undefined}
            />
          )}
        </Inline>
      )}
    </Row>
  );
}
