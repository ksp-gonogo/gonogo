import type { ValueCommand } from "@ksp-gonogo/sitrep-sdk";
import { useEffect, useId, useState } from "react";
import styled from "styled-components";
import { useCommandInput } from "./CommandButton/commandInput";
import { Field, FieldHint, FieldLabel, Input } from "./Form";
import { LiveRegion } from "./LiveRegion";
import { Text } from "./Text";
import { Tooltip } from "./Tooltip";

/**
 * Props for {@link TextField}. Useful for letting the operator type a name.
 * Taken by {@link TextField}.
 *
 * @category Form
 */
export interface TextFieldBaseProps {
  /** Shown above the field and tied to it, so the field is never unlabelled. */
  label: string;
  /** The text now in the field. */
  value: string;
  /**
   * The message saying why the current text is refused, shown under the field;
   * setting it marks the field invalid. The field validates nothing itself, so
   * the caller decides what is refused (a duplicate name, a mod's naming rule).
   */
  invalid?: string;
  /** Shown faint in the empty field. Absent, the empty field shows nothing. */
  placeholder?: string;
  /** The most characters the field takes. Absent, no limit. */
  maxLength?: number;
  /** A test id for the input element. */
  "data-testid"?: string;
}

/**
 * The props of a {@link TextField} that changes text the caller holds.
 *
 * @category Form
 */
export type PlainTextFieldProps = {
  /** Called with the whole new text on every edit. */
  onChange: (next: string) => void;
  /** Shows the text but takes no input. */
  disabled?: boolean;
  command?: never;
  unavailable?: never;
};

/**
 * The props of a {@link TextField} that sends a command: `value` is the text
 * the vessel reports, and the text typed is sent when the operator presses
 * Enter or leaves the field, never on each keystroke.
 *
 * @category Form
 */
export interface CommandedTextFieldProps {
  /** The command the typed text sends, made with `toArgs` on a `useCommand` handle and given the text. */
  // biome-ignore lint/suspicious/noExplicitAny: a command of any argument and reply types
  command: ValueCommand<string, any, any>;
  /** Why the text cannot be sent now. The field is drawn dimmed with this as its tip and nothing is sent. */
  unavailable?: string | null;
  onChange?: never;
  disabled?: never;
}

/**
 * Props for {@link TextField}. Useful for letting the operator type a name.
 * Taken by {@link TextField}.
 *
 * @category Form
 */
export type TextFieldProps = TextFieldBaseProps &
  (PlainTextFieldProps | CommandedTextFieldProps);

/**
 * A single line of free text: a name the operator types. Useful for naming a
 * station, a vessel or a saved layout.
 *
 * `TextField`, {@link UnitInput} or {@link Stepper}? The value decides:
 *
 *   - `TextField` holds text whose content is the point and which nothing can
 *     validate arithmetically, such as a name
 *   - {@link UnitInput} holds a quantity with a unit, where any number in range
 *     is legal
 *   - {@link Stepper} holds one member of a small closed set, where the set is
 *     the point
 *
 * The invalid message is `aria-describedby`-linked and `aria-invalid` is set
 * with it, so a screen reader hears the refusal on the field rather than only
 * seeing it beside it.
 *
 * @category Form
 */
export function TextField(props: TextFieldProps) {
  if (props.command) {
    return <CommandedTextField {...props} command={props.command} />;
  }
  return <PlainTextField {...props} />;
}

const FieldBox = styled.div`
  position: relative;
  width: 100%;

`;

/* The word sits inside the field at its end, so nothing moves. */
const FieldWord = styled.span`
  position: absolute;
  inset-block: 0;
  inset-inline-end: var(--gap-related);
  display: flex;
  align-items: center;
  pointer-events: none;
  font-size: var(--font-size-caption);
  color: var(--color-text-muted);
  letter-spacing: 0.08em;
`;

function CommandedTextField({
  label,
  value,
  command,
  unavailable,
  invalid,
  placeholder,
  maxLength,
  "data-testid": testId,
}: TextFieldBaseProps & CommandedTextFieldProps) {
  const id = useId();
  const errorId = `${id}-invalid`;
  const input = useCommandInput({ command, unavailable });
  // Null shows the reported text; typing or an unanswered send shows the draft.
  const [draft, setDraft] = useState<string | null>(null);
  const settled = !input.control.isSent;
  const failed = input.control.isRefused || input.control.isLost;
  useEffect(() => {
    if (failed) setDraft(null);
  }, [failed]);
  useEffect(() => {
    if (settled && !failed) setDraft((d) => (d === value ? null : d));
  }, [settled, failed, value]);
  const commit = () => {
    if (draft === null || draft === value || input.inert) return;
    input.send(draft);
  };
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Tooltip text={input.tip}>
        <FieldBox>
          <Input
            {...input.edge}
            aria-describedby={invalid == null ? undefined : errorId}
            aria-invalid={invalid == null ? undefined : true}
            data-testid={testId}
            id={id}
            maxLength={maxLength}
            onBlur={commit}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
            }}
            placeholder={placeholder}
            type="text"
            value={draft ?? value}
          />
          <FieldWord aria-hidden="true">{input.word}</FieldWord>
          <LiveRegion visuallyHidden>{input.announce}</LiveRegion>
        </FieldBox>
      </Tooltip>
      {invalid != null && (
        <FieldHint id={errorId}>
          <Text size="xs" tone="warn">
            {invalid}
          </Text>
        </FieldHint>
      )}
    </Field>
  );
}

function PlainTextField({
  label,
  value,
  onChange,
  invalid,
  placeholder,
  maxLength,
  disabled,
  "data-testid": testId,
}: TextFieldBaseProps & PlainTextFieldProps) {
  const id = useId();
  const errorId = `${id}-invalid`;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        aria-describedby={invalid == null ? undefined : errorId}
        aria-invalid={invalid == null ? undefined : true}
        data-testid={testId}
        disabled={disabled}
        id={id}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type="text"
        value={value}
      />
      {invalid != null && (
        <FieldHint id={errorId}>
          <Text size="xs" tone="warn">
            {invalid}
          </Text>
        </FieldHint>
      )}
    </Field>
  );
}
