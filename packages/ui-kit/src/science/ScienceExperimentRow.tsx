import type { TopicPayload } from "@ksp-gonogo/sitrep-sdk"; // erased at build; no runtime edge
import { useEffect, useState } from "react";
import { ActionButton } from "../ActionButton";
import { Badge } from "../Badge";
import { Inline } from "../Inline";
import { Row, RowName } from "../Row";
import { Spinner } from "../Spinner";

/**
 * The row's data contract. Presentational and already-normalised (plain
 * booleans, not optionals) so a widget's own parsed-instrument shape maps in
 * directly. This is the widget-facing projection of the SDK's
 * `InstrumentEntry` (`science.instruments` topic), *not* `ExperimentEntry`
 * (`science.experiments`) — the row needs `partId`/`hasData`/`rerunnable`,
 * fields `ExperimentEntry` doesn't carry. See
 * `local_docs/telemetry-mod/uikit-p0-brief-row.md` for the full field-level
 * comparison that drove this choice.
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
  /** Called with `instrument.partId` when the operator confirms Deploy. */
  onDeploy?: (partId: string) => void;
  /**
   * Called with `instrument.partId` after the arm→confirm handshake — never
   * fired directly off a bare click.
   */
  onTransmit?: (partId: string) => void;
}

const ARM_TIMEOUT_MS = 4000;

/**
 * A single science-instrument row: name, state badges, and the
 * Deploy/Transmit action cluster. Extracted verbatim from ScienceOfficer's
 * per-instrument `<Row>` + `InstrumentActions` — same arm→confirm→pending
 * behaviour, same badge tones, now composed entirely from kit primitives.
 *
 * Data/framework-free by design (§1 export-safety boundary): this component
 * never dispatches a command or reads telemetry itself. The arm/pending
 * control state is presentational UI state and stays local; the actual
 * command dispatch is the caller's job via `onDeploy`/`onTransmit`.
 */
export function ScienceExperimentRow({
  instrument,
  onDeploy,
  onTransmit,
}: Readonly<ScienceExperimentRowProps>) {
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState<"deploy" | "transmit" | null>(null);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), ARM_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [armed]);

  // Clear the pending state once telemetry reports the new instrument state
  // — `deployed`/`hasData` transitions are the success signal. Fall back to
  // a 5s safety timeout so an action that never lands doesn't leave the
  // button forever-busy.
  useEffect(() => {
    if (pending === null) return;
    if (pending === "deploy" && (instrument.deployed || instrument.hasData)) {
      setPending(null);
      return;
    }
    if (pending === "transmit" && !instrument.hasData) {
      setPending(null);
      return;
    }
    const id = setTimeout(() => setPending(null), 5_000);
    return () => clearTimeout(id);
  }, [pending, instrument.deployed, instrument.hasData]);

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
          entirely rather than greying them out — the INOPERABLE badge
          already tells the operator why nothing's available. */}
      {!instrument.inoperable && (
        <Inline inset>
          {!instrument.deployed && !instrument.hasData && (
            <ActionButton
              type="button"
              disabled={pending === "deploy"}
              aria-busy={pending === "deploy"}
              onClick={() => {
                if (pending !== null) return;
                setPending("deploy");
                onDeploy?.(instrument.partId);
              }}
            >
              {pending === "deploy" ? (
                <>
                  <Spinner size={10} /> Deploying…
                </>
              ) : (
                "Deploy"
              )}
            </ActionButton>
          )}
          {instrument.hasData &&
            (armed ? (
              <ActionButton
                type="button"
                tone="go"
                disabled={pending === "transmit"}
                aria-busy={pending === "transmit"}
                onClick={() => {
                  if (pending !== null) return;
                  setArmed(false);
                  setPending("transmit");
                  onTransmit?.(instrument.partId);
                }}
              >
                {pending === "transmit" ? (
                  <>
                    <Spinner size={10} /> Transmitting…
                  </>
                ) : (
                  "Confirm transmit"
                )}
              </ActionButton>
            ) : (
              <ActionButton type="button" onClick={() => setArmed(true)}>
                Transmit
              </ActionButton>
            ))}
        </Inline>
      )}
    </Row>
  );
}
