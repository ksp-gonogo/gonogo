import { useTelemetry } from "@ksp-gonogo/core";
import { useCommand } from "@ksp-gonogo/sitrep-client";
import {
  type ControlFrame,
  type ControlFrameOption,
  controlFrameLabel,
  type SetControlFrameArgs,
} from "@ksp-gonogo/sitrep-sdk";
import {
  Cluster,
  CommandButton,
  NullValue,
  ReadOnlyField,
  Select,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useId, useState } from "react";
import styled from "styled-components";
import { RowLabel } from "./settingsLayout";

/**
 * The game's Control Frame, and the one place it is set from.
 *
 * Only the frames `system.frame` lists as settable are offered, so a stream
 * that can be put in none (stock) shows the frame and nothing to press. A set
 * moves the in-game view and nothing else: no widget's read frame is written
 * from here.
 */
export function ControlFrameSettings() {
  // A frame does not lapse when a sample goes missing, so a held reading is still the frame.
  const reading = useTelemetry("system.frame");
  const frame: ControlFrame | null | undefined =
    reading.state === "observed" || reading.state === "held"
      ? reading.value
      : undefined;
  // Absent is not empty: a source that did not say shows the placeholder, never "None".
  const settable = frame?.settableFrames;
  // The frame already in force is not somewhere to go.
  const elsewhere = frame
    ? settable?.filter((option) => !sameFrame(option, frame))
    : undefined;

  return (
    <>
      <FrameInForce>
        <FrameInForce__Term>Control Frame</FrameInForce__Term>
        <FrameInForce__Value>
          {frame === undefined ? (
            <NullValue />
          ) : frame === null ? (
            "Not reported"
          ) : (
            labelOf(frame)
          )}
        </FrameInForce__Value>
      </FrameInForce>
      {frame && elsewhere && elsewhere.length > 0 && (
        <SetControlFrame options={elsewhere} />
      )}
      {frame && !settable?.length && (
        <ReadOnlyField
          label="Settable frames"
          value={settable ? "None" : undefined}
        />
      )}
    </>
  );
}

function SetControlFrame({
  options,
}: {
  options: readonly ControlFrameOption[];
}) {
  const selectId = useId();
  // The settings modal has no rail; the button states its own outcome.
  const set = useCommand("system.frame.set", { rail: false });
  const [chosen, setChosen] = useState(0);

  // The list is the stream's; a shorter one must not leave the choice pointing past its end.
  useEffect(() => {
    if (chosen >= options.length) setChosen(0);
  }, [chosen, options.length]);

  const option = options[chosen] ?? options[0];
  if (option === undefined) return null;
  const optionLabel = labelOf(option);

  return (
    <SetControlFrame__Line>
      <RowLabel as="label" htmlFor={selectId}>
        Set Control Frame
      </RowLabel>
      <Cluster gap="related-dense" justify="end">
        <SetControlFrame__Select
          id={selectId}
          value={chosen}
          onChange={(event) => setChosen(Number(event.target.value))}
        >
          {options.map((each, index) => (
            <option key={keyOf(each)} value={index}>
              {labelOf(each)}
            </option>
          ))}
        </SetControlFrame__Select>
        <CommandButton
          handle={set}
          args={argsOf(option)}
          commandLabel={`Set Control Frame to ${optionLabel}`}
          label="Set"
          confirmLabel="Confirm"
          confirmAriaLabel={`Confirm: set Control Frame to ${optionLabel}`}
          aria-label={`Set Control Frame to ${optionLabel}`}
          size="sm"
        />
      </Cluster>
    </SetControlFrame__Line>
  );
}

function keyOf(option: ControlFrameOption): string {
  return [
    option.kind,
    option.centreBody,
    option.primaryBody,
    option.secondaryBody,
    option.targetFrameSelected,
  ].join("|");
}

/** The option as the command takes it: the wire's nulls are the args' absences. */
function argsOf(option: ControlFrameOption): SetControlFrameArgs {
  return {
    kind: option.kind,
    centreBody: option.centreBody ?? undefined,
    primaryBody: option.primaryBody ?? undefined,
    secondaryBody: option.secondaryBody ?? undefined,
    targetFrameSelected: option.targetFrameSelected ?? undefined,
  };
}

/**
 * The frame's name, with its bodies where the name alone does not carry them:
 * "Barycentric rotating" is one name for every pair.
 */
function labelOf(option: ControlFrameOption): string {
  const name = controlFrameLabel(option) ?? `Frame ${option.kind}`;
  const bodies = [option.centreBody, option.primaryBody, option.secondaryBody]
    .filter((body): body is string => typeof body === "string")
    .filter((body) => !name.includes(body));
  return bodies.length > 0 ? `${name}, ${bodies.join("-")}` : name;
}

/** Whether the view is already in `option`. The frame's sets are not compared: a set names only the heads. */
function sameFrame(option: ControlFrameOption, frame: ControlFrame): boolean {
  return (
    option.kind === frame.kind &&
    (option.centreBody ?? null) === (frame.centreBody ?? null) &&
    (option.primaryBody ?? null) === (frame.primaryBody ?? null) &&
    (option.secondaryBody ?? null) === (frame.secondaryBody ?? null) &&
    (option.targetFrameSelected ?? false) ===
      (frame.targetFrameSelected ?? false)
  );
}

/* Laid out as ReadOnlyField is, so it reads as one list with the row beneath it. */
const FrameInForce = styled.dl`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--gap-field-term);
  margin: 0;
`;

const FrameInForce__Term = styled.dt`
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--font-size-value);
  color: var(--color-text-primary);
`;

const FrameInForce__Value = styled.dd`
  margin: 0;
  min-width: 0;
  text-align: right;
  font-size: var(--font-size-value);
  color: var(--color-text-primary);
`;

const SetControlFrame__Line = styled(Cluster).attrs({
  gap: "section-comfortable" as const,
})``;

const SetControlFrame__Select = styled(Select)`
  width: auto;
  min-width: 14em;
`;
