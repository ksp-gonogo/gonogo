import {
  type ReadFrameChoice,
  readFrameChoicesEqual,
} from "@ksp-gonogo/sitrep-sdk/frames";
import { Field, FieldHint, FieldLabel, Select } from "./Form";

/**
 * One frame a {@link ReadFrameControl} can offer, and what an operator calls it.
 *
 * @category Form
 */
export interface ReadFrameOption {
  choice: ReadFrameChoice;
  label: string;
}

/**
 * Props for {@link ReadFrameControl}.
 *
 * @category Form
 */
export interface ReadFrameControlProps {
  /** Put on the `<select>`, so `label` (as `htmlFor`) names it. */
  id: string;
  label: string;
  /** The widget's current read frame. Shown as a blank, disabled placeholder when it matches nothing on `options`, e.g. before the widget's catalogue has arrived. */
  value: ReadFrameChoice;
  options: readonly ReadFrameOption[];
  onChange: (choice: ReadFrameChoice) => void;
  hint?: string;
}

/**
 * The control a frame-dependent widget picks its read frame with: a labelled,
 * keyboard-operable `<select>` over `options`, with an optional hint below.
 * The selected option is found by frame equality with `value`
 * (`readFrameChoicesEqual` from `@ksp-gonogo/sitrep-sdk/frames`), so options
 * need no ids of their own.
 *
 * The caller decides what belongs on `options`: which named frames apply to
 * what it is drawing, and whether "follow the Control Frame" is one of them.
 * Offer that entry only when the live Control Frame would draw something the
 * other entries do not already draw; `readFrameChoicesEqual` is the check.
 *
 * @category Form
 */
export function ReadFrameControl({
  id,
  label,
  value,
  options,
  onChange,
  hint,
}: Readonly<ReadFrameControlProps>) {
  const selectedIndex = options.findIndex((option) =>
    readFrameChoicesEqual(option.choice, value),
  );

  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        id={id}
        value={selectedIndex === -1 ? "" : String(selectedIndex)}
        onChange={(event) => {
          const option = options[Number(event.target.value)];
          if (option !== undefined) onChange(option.choice);
        }}
      >
        {selectedIndex === -1 && <option value="" disabled />}
        {options.map((option, index) => (
          <option
            key={`${option.choice.kind}-${option.choice.bodyIndex ?? "none"}`}
            value={index}
          >
            {option.label}
          </option>
        ))}
      </Select>
      {hint !== undefined && <FieldHint>{hint}</FieldHint>}
    </Field>
  );
}
