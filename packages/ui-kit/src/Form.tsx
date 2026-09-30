import styled, { css } from "styled-components";
import { focusRing } from "./focusRing";

/**
 * A vertical form body, the root of a widget's config form. Each child is
 * usually a {@link Field} (label above control) or a {@link FieldRow} (label
 * beside control).
 *
 * `$boxed` puts it on a panel surface with a border and its own padding, and
 * tightens the gap, since a boxed form is denser than a settings section.
 *
 * @example
 * ```tsx
 * import {
 *   ConfigForm,
 *   Field,
 *   FieldHint,
 *   FieldLabel,
 *   Input,
 *   Select,
 * } from "@ksp-gonogo/ui-kit";
 *
 * <ConfigForm>
 *   <Field>
 *     <FieldLabel htmlFor="ag-select">Action Group</FieldLabel>
 *     <Select
 *       id="ag-select"
 *       value={groupId}
 *       onChange={(e) => setGroupId(e.target.value)}
 *     >
 *       {groups.map((g) => (
 *         <option key={g.id} value={g.id}>{g.name}</option>
 *       ))}
 *     </Select>
 *   </Field>
 *   <Field>
 *     <FieldLabel htmlFor="ag-label">Custom Label</FieldLabel>
 *     <Input
 *       id="ag-label"
 *       type="text"
 *       value={label}
 *       onChange={(e) => setLabel(e.target.value)}
 *     />
 *     <FieldHint>Leave blank to use the action group name.</FieldHint>
 *   </Field>
 * </ConfigForm>
 * ```
 *
 * @category Form
 */
export const ConfigForm = styled.div<{ $boxed?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: ${({ $boxed }) => ($boxed ? "var(--gap-form-field-boxed)" : "var(--gap-form-field)")};
  ${({ $boxed }) =>
    $boxed
      ? `
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-regular);
  padding: var(--inset-form-box);
`
      : ""}
`;

/**
 * One labelled control in a {@link ConfigForm}, stacked: {@link FieldLabel} on
 * top, the control below, an optional {@link FieldHint} under it. Tie the label
 * to the control with `htmlFor` and `id`.
 *
 * @example
 * ```tsx
 * <Field>
 *   <FieldLabel htmlFor="gain">Gain</FieldLabel>
 *   <Input id="gain" value={gain} onChange={(e) => setGain(e.target.value)} />
 *   <FieldHint>Applied on the next frame.</FieldHint>
 * </Field>
 * ```
 *
 * @category Form
 */
export const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-field-label);
`;

/**
 * A labelled control laid out horizontally: label on the left, control on the right, vertically centred.
 *
 * @category Form
 */
export const FieldRow = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-field-label-inline);
`;

/**
 * The label of a {@link Field} or {@link FieldRow}: a native `<label>` in small uppercase caption type. Pass `htmlFor` to tie it to its control.
 *
 * @category Form
 */
export const FieldLabel = styled.label`
  font-size: var(--font-size-caption);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;

/**
 * Small, faint help text under a control in a {@link Field}. Give it an `id` and point the control's `aria-describedby` at it when it should be read with the control.
 *
 * @category Form
 */
export const FieldHint = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-faint);
`;

/**
 * A horizontal row of buttons at the foot of a form, vertically centred.
 *
 * @category Form
 */
export const FormActions = styled.div`
  display: flex;
  gap: var(--gap-control-row);
  align-items: center;
`;

const inputBase = css`
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-regular);
  color: var(--color-text-primary);
  font-size: var(--font-size-compact);
  padding: var(--inset-field);

  &:focus {
    /* The accent border on the raised surface clears WCAG 1.4.11's 3:1. */
    border-color: var(--color-accent-fg);
    outline: none;
  }

  ${focusRing}

  /* The browser's own clear control ignores the theme; SearchBox draws the kit's. */
  &::-webkit-search-cancel-button {
    appearance: none;
  }

  @media (pointer: coarse) {
    min-height: 44px;
    padding: var(--inset-field-touch);
    /* 16px stops iOS Safari zooming on focus; a literal, because the threshold is absolute. */
    font-size: 16px;
  }
`;

/**
 * A native `<input>` in the kit's field style, full width, with a visible focus ring and a 44px touch target on coarse pointers.
 *
 * @category Form
 */
export const Input = styled.input`
  ${inputBase}
  width: 100%;
`;

/**
 * A native `<select>` in the kit's field style, full width. For a long or searchable list, use {@link ComboboxListbox} with an {@link Input}.
 *
 * @category Form
 */
export const Select = styled.select`
  ${inputBase}
  width: 100%;
`;

/**
 * A native `<textarea>` in the kit's field style, full width, resizable vertically only.
 *
 * @category Form
 */
export const Textarea = styled.textarea`
  ${inputBase}
  width: 100%;
  resize: vertical;
`;
