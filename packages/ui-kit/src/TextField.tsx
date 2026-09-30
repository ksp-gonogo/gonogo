import { useId } from "react";
import { Field, FieldHint, FieldLabel, Input } from "./Form";
import { Text } from "./Text";

/**
 * Props for {@link TextField}.
 *
 * @category Form
 */
export interface TextFieldProps {
  /** Shown above the field and tied to it, so the field is never unlabelled. */
  label: string;
  value: string;
  onChange: (next: string) => void;
  /**
   * The message saying why the current text is refused, shown under the field;
   * setting it marks the field invalid. The field validates nothing itself, so
   * the caller decides what is refused (a duplicate name, a mod's naming rule).
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
