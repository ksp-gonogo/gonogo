import { useId } from "react";
import { Field, FieldHint, FieldLabel, Input } from "./Form";
import { Text } from "./Text";

export interface TextFieldProps {
  /** Shown above the field and tied to it, so the field is never unlabelled. */
  label: string;
  value: string;
  onChange: (next: string) => void;
  /**
   * Refused by the control that owns the field, not by the field: naming a
   * complex is refused for reasons only the caller knows (a duplicate at this
   * centre, RP-1's own wording), and a field that invented its own rule would
   * disagree with the command.
   */
  invalid?: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  "data-testid"?: string;
}

/**
 * A single line of free text: a name somebody types.
 *
 * `TextField`, `UnitInput` or `Stepper`? The quantity decides, as it does
 * between the other two:
 *
 *   - `TextField` holds text whose content is the point and which nothing can
 *     validate arithmetically. A name.
 *   - `UnitInput` holds a quantity with a unit, where any number in range is
 *     legal.
 *   - `Stepper` holds one member of a small closed set, where the set is the
 *     point.
 *
 * The invalid message is `aria-describedby`-linked and `aria-invalid` is set
 * with it, so a screen reader hears the refusal on the field rather than only
 * seeing it beside it.
 */
export function TextField({
  label,
  value,
  onChange,
  invalid,
  placeholder,
  maxLength,
  disabled,
  "data-testid": testId,
}: TextFieldProps) {
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
