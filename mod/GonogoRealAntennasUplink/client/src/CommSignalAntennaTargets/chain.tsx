/**
 * The fallback-chain half of an antenna card: what the craft is holding, and the
 * controls that give it a new list.
 *
 * A chain is an ORDERED list of targets the craft tries when it has no link,
 * walked on the craft rather than from here. That is not an implementation
 * detail worth hiding: the whole reason a chain exists is that the moment a
 * fallback is needed is the moment no command can arrive, so the operator's one
 * press sends the list and the craft does the rest. The readout is therefore a
 * report of something happening minutes away, not a mirror of local state.
 */

import { useCommand, value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  CommandButton,
  GhostButton,
  magnitudeOf,
  magnitudeOr,
  type Quantityish,
  type Severity,
  Stack,
  Text,
  Unit,
  usePanelDelay,
} from "@ksp-gonogo/ui-kit";
import type {
  RealAntennasAntennaChain,
  RealAntennasTargetStep,
  RealAntennasTargetStepArgs,
} from "../__generated__/contract";

const LABEL_STYLE = {
  letterSpacing: "0.1em",
  textTransform: "uppercase" as const,
};

/**
 * The mode names as an operator reads them. The same five the aim control
 * offers, kept here as its own map rather than imported so a chain entry
 * renders even for a mode the current form is not on.
 */
const MODE_LABELS: Record<string, string> = {
  BodyCenter: "Body centre",
  Vessel: "Vessel",
  BodyLatLonAlt: "Surface point",
  AzEl: "Azimuth / elevation",
  OrbitRelative: "Orbit relative",
};

/**
 * How each walk state reads on a badge.
 *
 * `holding` is the resting state of a working fallback and takes the floor, not
 * a green: the chain is doing nothing because nothing is wrong, and a panel lit
 * up by every idle chain says nothing when one is actually walking. `blocked`
 * is a caution rather than a warning because the craft is not necessarily in
 * trouble, the chain just cannot act.
 */
const STATE_SEVERITY: Record<string, Severity> = {
  holding: "nominal",
  settling: "info",
  walking: "warning",
  blocked: "caution",
};

/** What each walk state is called, so the wire's own word is never shown raw. */
const STATE_LABELS: Record<string, string> = {
  holding: "Holding",
  settling: "Settling",
  walking: "Walking",
  blocked: "Blocked",
};

/**
 * One entry as a sentence: the mode, and the parameters that mode actually
 * reads. Every number goes through `Unit`, including a draft entry's, which is
 * why a draft's bare numbers are minted into quantities here rather than
 * printed with a symbol appended.
 */
function StepLabel({ step }: { step: ChainStep }) {
  const mode = MODE_LABELS[step.mode] ?? step.mode;
  if (step.mode === "Vessel") {
    return (
      <>
        {mode}
        {step.vesselId ? ` · ${step.vesselId}` : ""}
      </>
    );
  }
  if (step.mode === "BodyCenter") {
    return <>{`${mode} · ${step.bodyName || "home"}`}</>;
  }
  if (step.mode === "BodyLatLonAlt") {
    return (
      <>
        {`${mode} · ${step.bodyName || "home"} `}
        <Unit value={degrees(step.latitude)} />
        {" / "}
        <Unit value={degrees(step.longitude)} />
        {step.altitude != null ? (
          <>
            {" · "}
            <Unit value={metres(step.altitude)} />
          </>
        ) : null}
      </>
    );
  }
  if (step.mode === "AzEl") {
    return (
      <>
        {`${mode} · `}
        <Unit value={degrees(step.azimuth)} />
        {" / "}
        <Unit value={degrees(step.elevation)} />
      </>
    );
  }
  return (
    <>
      {`${mode} · `}
      <Unit value={degrees(step.forward)} />
      {" / "}
      <Unit value={degrees(step.elevation)} />
    </>
  );
}

/**
 * An entry from either side of the wire. The read side arrives with its units
 * already on it and the draft the operator is building does not, because a
 * command carries plain numbers; both render through the same label, so both are
 * accepted here and normalised on the way to `Unit`.
 */
type ChainStep = RealAntennasTargetStep | RealAntennasTargetStepArgs;

/**
 * The entry's number as a quantity, whichever form it arrived in. A read entry
 * comes off the wire hydrated and a staged one is the plain number a command
 * carries, so this is where the two meet, and the unwrap is the shared one
 * rather than a reach into the shape.
 */
function degrees(quantity: Quantityish) {
  const magnitude = magnitudeOf(quantity);
  return magnitude === null ? undefined : value("°", magnitude);
}

function metres(quantity: Quantityish) {
  const magnitude = magnitudeOf(quantity);
  return magnitude === null ? undefined : value("m", magnitude);
}

/**
 * Pairs each entry with its POSITION, which is the whole of its identity: an
 * entry carries no id and does not need one, because where it sits in the list
 * is what says when the craft tries it. Two identical entries at different
 * positions are two different fallbacks, and the craft addresses the one it is
 * on by index.
 */
function positioned<T>(steps: readonly T[]): { position: number; step: T }[] {
  return steps.map((step, position) => ({ position, step }));
}

export interface AntennaChainProps {
  antennaId: string;
  antennaName: string;
  /** What the craft reports holding, or undefined when it holds no chain. */
  chain: RealAntennasAntennaChain | undefined;
  /** The entries the operator has staged but not yet sent. */
  draft: readonly RealAntennasTargetStepArgs[];
  /** Append whatever the aim controls above are currently composing. */
  onStage: () => void;
  /** Drop the last staged entry, which is the only edit a list this short needs. */
  onUnstage: () => void;
  /** Called once the craft has accepted a chain, so the staging list can empty. */
  onSent: () => void;
}

/**
 * The chain block. Rendered only for a steerable antenna, since the whole
 * feature is about where a dish is pointed.
 */
export function AntennaChain({
  antennaId,
  antennaName,
  chain,
  draft,
  onStage,
  onUnstage,
  onSent,
}: AntennaChainProps) {
  const setChain = useCommand("realantennas.antenna.targetChain");
  usePanelDelay(setChain);

  /** Null while the walk has never started, which is not the same as entry zero. */
  const activeStep = magnitudeOf(chain?.activeStep);
  const laps = magnitudeOr(chain?.laps, 0);

  return (
    <Stack gap="sm">
      <Cluster gap="md" wrap align="center">
        <Text size="xs" tone="muted" style={LABEL_STYLE}>
          Fallback chain
        </Text>
        {chain ? (
          <Badge severity={STATE_SEVERITY[chain.state] ?? "info"} size="sm">
            {STATE_LABELS[chain.state] ?? chain.state}
          </Badge>
        ) : (
          <Text size="xs" tone="muted">
            None set
          </Text>
        )}
        {/*
          The lap count is shown only once it is not zero, and it is the number
          that says the chain has stopped being a fallback and become a search:
          every entry has been tried and the cause is not in the list.
        */}
        {laps > 0 ? (
          <Text size="xs" tone="muted">
            {`${laps} full ${laps === 1 ? "pass" : "passes"} with no link`}
          </Text>
        ) : null}
      </Cluster>

      {chain?.detail ? (
        <Text size="xs" tone="muted">
          {chain.detail}
        </Text>
      ) : null}

      {chain ? (
        <ol aria-label={`Fallback chain for ${antennaName}`}>
          {positioned(chain.steps).map(({ position, step }) => {
            const aimedHere = position === activeStep;
            return (
              <li key={position}>
                <Text size="sm" tone={aimedHere ? "default" : "muted"}>
                  <StepLabel step={step} />
                  {aimedHere ? " · aimed here now" : ""}
                </Text>
              </li>
            );
          })}
        </ol>
      ) : null}

      {chain ? (
        <Text size="xs" tone="muted">
          {"Each target is given "}
          <Unit value={chain.settleSeconds} />
          {" to produce a link before the craft tries the next."}
        </Text>
      ) : null}

      {/*
        The staging list, and why it is separate from the chain above. A chain
        rides the same light-time delay every other signal to the craft does, so
        what the craft is holding and what the operator is composing are two
        different things for as long as the command is in flight; showing them as
        one list would make a chain look armed the moment it was pressed.
      */}
      {draft.length > 0 ? (
        <ol aria-label={`Chain being composed for ${antennaName}`}>
          {positioned(draft).map(({ position, step }) => (
            <li key={position}>
              <Text size="sm" tone="default">
                <StepLabel step={step} />
              </Text>
            </li>
          ))}
        </ol>
      ) : null}

      <Cluster gap="md" wrap justify="start">
        <GhostButton type="button" onClick={onStage}>
          ADD TARGET ABOVE
        </GhostButton>
        {draft.length > 0 ? (
          <GhostButton type="button" onClick={onUnstage}>
            REMOVE LAST
          </GhostButton>
        ) : null}
        {draft.length > 0 ? (
          <CommandButton
            size="sm"
            handle={setChain}
            args={{ antennaId, steps: [...draft] }}
            commandLabel={`Set the fallback chain for ${antennaName}`}
            label="SET CHAIN"
            confirmLabel="CONFIRM CHAIN"
            pendingLabel="Sending..."
            onConfirmed={onSent}
          />
        ) : null}
        {/*
          An empty list is the only way a walk stops, which is why the clear is
          the same command rather than one of its own, and why it only appears
          once the craft says it is holding something to clear.
        */}
        {chain ? (
          <CommandButton
            size="sm"
            handle={setChain}
            args={{ antennaId, steps: [] }}
            commandLabel={`Clear the fallback chain for ${antennaName}`}
            label="CLEAR CHAIN"
            confirmLabel="CONFIRM CLEAR"
            pendingLabel="Clearing..."
          />
        ) : null}
      </Cluster>
    </Stack>
  );
}
