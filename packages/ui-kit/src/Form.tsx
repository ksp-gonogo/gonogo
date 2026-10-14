import styled, { css } from "styled-components";
import { focusRing } from "./focusRing";

/**
 * A vertical form body, the root of a widget's config form. Each child is
 * usually a {@link Field} (label above control) or a {@link FieldRow} (label
 * beside control). Useful for laying out the settings the operator edits for
 * one widget. Used by the config forms of the graph, warp control and target
 * picker widgets.
 *
 * `$boxed` puts it on a panel surface with a border and its own padding, and
 * tightens the gap, since a boxed form is denser than a settings section. The
 * `$` prefix marks a styled-components transient prop: it styles the form and
 * is never passed on to the DOM element.
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
 * import { useState } from "react";
 *
 * function ActionGroupForm({
 *   groups,
 * }: {
 *   groups: ReadonlyArray<{ id: string; name: string }>;
 * }) {
 *   const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
 *   const [label, setLabel] = useState("");
 *   return (
 *     <ConfigForm>
 *       <Field>
 *         <FieldLabel htmlFor="ag-select">Action Group</FieldLabel>
 *         <Select
 *           id="ag-select"
 *           value={groupId}
 *           onChange={(e) => setGroupId(e.target.value)}
 *         >
 *           {groups.map((g) => (
 *             <option key={g.id} value={g.id}>{g.name}</option>
 *           ))}
 *         </Select>
 *       </Field>
 *       <Field>
 *         <FieldLabel htmlFor="ag-label">Custom Label</FieldLabel>
 *         <Input
 *           id="ag-label"
 *           type="text"
 *           value={label}
 *           onChange={(e) => setLabel(e.target.value)}
 *         />
 *         <FieldHint>Leave blank to use the action group name.</FieldHint>
 *       </Field>
 *     </ConfigForm>
 *   );
 * }
 * ```
 *
 * @category Form
 * @categoryDescription Form
 * Controls for entering values: labelled fields with hints, inputs and selects,
 * a combobox, a date field on the game's calendar, a reference frame picker, a
 * jog wheel and read-only fields. A widget's config form is built from these.
 */
export const ConfigForm = styled.div<{
  /** Puts the form on a bordered panel surface with its own padding and a tighter gap. */
  $boxed?: boolean;
}>`
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
 * top, the control below, an optional {@link FieldHint} under it. Useful for
 * any setting the operator edits. Used by the graph config form and the alarms
 * dialog. Tie the label to the control with `htmlFor` and `id`. For a single
 * line of text with no hint, prefer {@link TextField}, which does all of this
 * in one; build with `Field` and {@link Input} for a control it does not cover
 * or a field that needs a {@link FieldHint}.
 *
 * @example
 * ```tsx
 * import { Field, FieldHint, FieldLabel, Input } from "@ksp-gonogo/ui-kit";
 * import { useState } from "react";
 *
 * function GainField() {
 *   const [gain, setGain] = useState("1");
 *   return (
 *     <Field>
 *       <FieldLabel htmlFor="gain">Gain</FieldLabel>
 *       <Input id="gain" value={gain} onChange={(e) => setGain(e.target.value)} />
 *       <FieldHint>Applied on the next frame.</FieldHint>
 *     </Field>
 *   );
 * }
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
 * A labelled control laid out horizontally: label on the left, control on the
 * right, vertically centred. Useful for a compact setting such as a switch or a
 * short value. Used by the ground track widget's configuration form and the serial input
 * mapping tab. Pick {@link Field} instead when the control is wide, such as a
 * select or a text input, and wants the full width under its label.
 *
 * @example
 * ```tsx
 * import { ConfigForm, FieldLabel, FieldRow, Switch } from "@ksp-gonogo/ui-kit";
 * import { useState } from "react";
 *
 * function GridSetting() {
 *   const [showGrid, setShowGrid] = useState(false);
 *   return (
 *     <ConfigForm>
 *       <FieldRow>
 *         <FieldLabel>Show grid</FieldLabel>
 *         <Switch aria-label="Show grid" checked={showGrid} onChange={setShowGrid} />
 *       </FieldRow>
 *     </ConfigForm>
 *   );
 * }
 * ```
 *
 * @category Form
 */
export const FieldRow = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-field-label-inline);
`;

/**
 * The label of a {@link Field} or {@link FieldRow}: a native `<label>` in small
 * uppercase caption type. Useful for naming a control to the operator and to a
 * screen reader. Used by the alarms dialog. Pass `htmlFor` to tie it to its
 * control.
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
 * Small, faint help text under a control in a {@link Field}. Useful for telling
 * the operator what a value means or what range it accepts. Used by the alarms
 * dialog. Give it an `id` and point the control's `aria-describedby` at it when
 * it should be read with the control.
 *
 * @category Form
 */
export const FieldHint = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-faint);
`;

/**
 * A horizontal row of buttons at the foot of a form, vertically centred. Useful
 * for the save and cancel controls of a form the operator fills in. Used by the
 * connection settings and the log manager.
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
 * A native `<input>` in the kit's field style, full width, with a visible focus
 * ring and a 44px touch target on coarse pointers. Useful for a text or number
 * value the operator types. Used by the alarms dialog and the connection
 * settings.
 *
 * @category Form
 */
export const Input = styled.input`
  ${inputBase}
  width: 100%;
`;

/**
 * A native `<select>` in the kit's field style, full width. Useful for choosing
 * one value from a short list. Used by the log manager. For a long or
 * searchable list, use {@link ComboboxListbox} with an {@link Input}.
 *
 * @category Form
 */
export const Select = styled.select`
  ${inputBase}
  width: 100%;
  appearance: none;
  /* The native arrow hugs the field's edge and cannot be inset, so the chevron is two gradient strokes drawn clear of it. */
  background-image:
    linear-gradient(45deg, transparent 50%, var(--color-text-muted) 50%),
    linear-gradient(135deg, var(--color-text-muted) 50%, transparent 50%);
  background-position:
    calc(100% - var(--offset-select-arrow-far)) 50%,
    calc(100% - var(--offset-select-arrow-near)) 50%;
  background-size:
    var(--size-select-arrow) var(--size-select-arrow),
    var(--size-select-arrow) var(--size-select-arrow);
  background-repeat: no-repeat;
  padding-inline-end: var(--inset-field-select-end);

  @media (pointer: coarse) {
    padding-inline-end: var(--inset-field-select-end);
  }
`;

/**
 * A native `<textarea>` in the kit's field style, full width, resizable
 * vertically only. Useful for a multi-line value the operator types or pastes.
 * Used by the log manager and the serial calibration wizard.
 *
 * @category Form
 */
export const Textarea = styled.textarea`
  ${inputBase}
  width: 100%;
  resize: vertical;
`;
