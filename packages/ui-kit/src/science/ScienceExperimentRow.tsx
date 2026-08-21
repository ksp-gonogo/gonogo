import type { TopicPayload } from "@ksp-gonogo/sitrep-sdk"; // erased at build; no runtime edge
import { Badge } from "../Badge";
import {
  CommandButton,
  type CommandButtonHandle,
} from "../CommandButton/CommandButton";
import { Inline } from "../Inline";
import { Row, RowName } from "../Row";

/**
 * The row's data contract. Presentational and already-normalised (plain
 * booleans, not optionals) so a widget's own parsed-instrument shape maps in
 * directly. This is the widget-facing projection of the SDK's
 * `InstrumentEntry` (`science.instruments` topic), *not* `ExperimentEntry`
 * (`science.experiments`): the row needs `partId`/`hasData`/`rerunnable`,
 * fields `ExperimentEntry` doesn't carry.
 */
export interface ScienceInstrument {
  partId: string;
  partTitle: string;
  expId: string;
  deployed: boolean;
  hasData: boolean;
  rerunnable: boolean;
  inoperable: boolean;
}

// Compile-time linkage to the SDK wire type (type-only; keeps the SDK
// dependency real without a runtime edge). `InstrumentEntry`'s fields are
// optional (wire uncertainty); `ScienceInstrument` is the normalised,
// already-parsed shape a widget hands down after its own `parseInstruments`.
// Asserted in `ScienceExperimentRow.test-d.ts`.
export type WireInstrument = TopicPayload<"science.instruments">[number];

export interface ScienceExperimentRowProps {
  /** The instrument this row renders. */
  instrument: ScienceInstrument;
  /**
   * The deploy command. Omit for a READ-ONLY listing: the control is then not
   * rendered at all, rather than rendered inert. It used to be an optional
   * callback, and a caller that passed none (the SCANsat science dropdown) got
   * a Deploy button that armed, spun for five seconds and did nothing, which
   * is the same lie about a command landing that this row's pending state
   * exists to avoid telling.
   */
  deployCmd?: CommandButtonHandle;
  /** The transmit command. Omit for a read-only listing; see `deployCmd`. */
  transmitCmd?: CommandButtonHandle;
}

/**
 * A single science-instrument row: name, state badges, and the Deploy/Transmit
 * action cluster.
 *
 * Data/framework-free by design (§1 export-safety boundary): this component
 * reads no telemetry. It does now DISPATCH, through the structural
 * `CommandButtonHandle` the caller hands it, which is a plain object and no
 * more of a framework edge than the callback it replaced. What that buys is the
 * shared command lifecycle: arm, in-flight and refused all behave here exactly
 * as they do on every other command control.
 *
 * The pending state used to be reconciled against `deployed`/`hasData`
 * flipping, with a 5s timeout behind it. That predicate is per-command and
 * cannot be shared; the dispatch promise settles for any command, so it is what
 * clears the control now.
 */
export function ScienceExperimentRow({
  instrument,
  deployCmd,
  transmitCmd,
}: Readonly<ScienceExperimentRowProps>) {
  return (
    <Row>
      <RowName>{instrument.partTitle}</RowName>
      <Inline>
        {instrument.hasData && <Badge tone="go">DATA</Badge>}
        {instrument.deployed && <Badge tone="neutral">DEPLOYED</Badge>}
        {!instrument.rerunnable && <Badge tone="neutral">ONE-SHOT</Badge>}
        {instrument.inoperable && <Badge tone="nogo">INOPERABLE</Badge>}
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
            />
          )}
        </Inline>
      )}
    </Row>
  );
}
