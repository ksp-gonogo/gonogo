import type { StaleGrade } from "@ksp-gonogo/sitrep-client";
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
  /**
   * The deploy command. Omit for a READ-ONLY listing: the control is then not
   * rendered at all, rather than rendered inert. A control that renders
   * without a command behind it arms, spins for five seconds and does nothing,
   * which is the same lie about a command landing that this row's in-flight
   * state exists to avoid telling.
   */
  deployCmd?: CommandButtonHandle;
  /** The transmit command. Omit for a read-only listing; see `deployCmd`. */
  transmitCmd?: CommandButtonHandle;
  /**
   * The grade of the instrument list this row was built from, when that list is
   * no longer arriving: every badge below is then the last state reported rather
   * than the state now. Nothing while it is current.
   *
   * It gates the CONTROLS as well as the badges, and that is the half that
   * matters: a Transmit pressed against a held row spends the one shot at a
   * science return on an instrument that may already have been emptied, and the
   * operator would have no way of knowing until the link came back. The badges
   * being old is a readout problem; the button is an action the operator
   * believes they have taken.
   */
  heldGrade?: StaleGrade;
}

/**
 * A single science-instrument row: name, state badges, and the Deploy/Transmit
 * action cluster.
 *
 * Data- and framework-free by design: it reads no telemetry and takes its
 * already-parsed `Instrument` as a prop, so the same row draws a stock
 * instrument and a contributed one. It does DISPATCH, through the structural
 * `CommandButtonHandle` the caller hands it, which is a plain object and no
 * more of a framework edge than the callback it replaced. What that buys is the
 * shared command lifecycle: arm, in-flight and refused all behave here exactly
 * as they do on every other command control.
 *
 * The pending state clears on the DISPATCH PROMISE settling, not on
 * `deployed`/`hasData` flipping behind a 5s timeout: that predicate is
 * per-command and cannot be shared, while the promise settles for any command.
 */
export function ScienceExperimentRow({
  instrument,
  deployCmd,
  transmitCmd,
  heldGrade,
}: Readonly<ScienceExperimentRowProps>) {
  const notCurrent = heldGrade !== undefined;
  const heldReason = `${instrument.partTitle}: instrument state is no longer current`;
  return (
    /* Wrapping, because how many badges this row carries is the instrument's
       business and not the layout's: all four draw at once for a one-shot that
       has been run, holds data and is now inoperable, and a fixed single line
       has nowhere to put them. It kept the badges and shaved the part name to
       one glyph, and inside a narrow column it painted them over the next
       column's name. */
    <Row wrap>
      {/* A part name is data, so at the narrow end it can still ellipsise
          however much room the row keeps for it; the tooltip is where the
          rest of it goes, the same as Panel's compacted title. */}
      <RowName title={instrument.partTitle}>{instrument.partTitle}</RowName>
      <Inline wrap>
        {instrument.hasData && <Badge severity="nominal">DATA</Badge>}
        {instrument.deployed && <Badge>DEPLOYED</Badge>}
        {!instrument.rerunnable && <Badge>ONE-SHOT</Badge>}
        {instrument.inoperable && <Badge severity="critical">INOPERABLE</Badge>}
        {/* A word rather than a shade over the badges beside it: dimming them
            would put the whole statement in a colour, which is the reading a
            colour-blind operator never gets (WCAG 1.4.1). Per row rather than
            once for the widget, because the row is what the button acts on. */}
        {heldGrade !== undefined && (
          /* `Badge` rather than `StreamStatusBadge`, which announces as a live
             region: eight rows going held at once is one event, and eight
             announcements of it is the flood the live-region rule exists to
             stop. The word and the severity are still the canonical ones. */
          <Badge
            severity={severityFromStreamStatus(heldGrade)}
            title={heldReason}
          >
            {formatStreamStatus(heldGrade)}
          </Badge>
        )}
      </Inline>
      {/* Inoperable instruments can't deploy or transmit. Hide the controls
          entirely rather than greying them out: the INOPERABLE badge
          already tells the operator why nothing's available. */}
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
              disabled={notCurrent}
              title={notCurrent ? heldReason : undefined}
            />
          )}
        </Inline>
      )}
    </Row>
  );
}
