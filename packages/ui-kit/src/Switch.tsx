import type { ValueCommand } from "@ksp-gonogo/sitrep-sdk";
import styled from "styled-components";
import { useCommandInput } from "./CommandButton/commandInput";
import { commandEdge } from "./commandEdge";
import { LiveRegion } from "./LiveRegion";
import { Tooltip } from "./Tooltip";

/**
 * The props every {@link Switch} takes. Useful for letting the operator turn a
 * widget option on or off. Taken by every form of {@link Switch}.
 *
 * @category Form
 */
export interface SwitchBaseProps {
  /** The checkbox's id, for a `<label htmlFor>` outside the switch. */
  id?: string;
}

/**
 * The props of a {@link Switch} that changes a setting the caller holds.
 *
 * @category Form
 */
export type PlainSwitchProps = {
  /** Whether the switch is on. The switch is controlled: it shows this value and changes only when the caller changes it. */
  checked: boolean;
  /** Called with the new state when the operator flips the switch. */
  onChange: (value: boolean) => void;
  /** Renders dimmed and non-interactive; `onChange` never fires. For a toggle whose effective state is controlled elsewhere, such as a sub-setting inert while its parent setting is off. */
  disabled?: boolean;
  command?: never;
};

/**
 * The props of a {@link Switch} that sends a command. The switch shows the
 * state the vessel reports and a flip sends the opposite, with a word beside
 * the track while the press is unanswered or has failed.
 *
 * @category Form
 */
export interface CommandedSwitchProps {
  /** The command a flip sends, made with `toArgs` on a `useCommand` handle and given `true` to switch on and `false` to switch off. */
  // biome-ignore lint/suspicious/noExplicitAny: a command of any argument and reply types
  command: ValueCommand<boolean, any, any>;
  /** The state as the vessel last reported it. Nothing yet is a third state, drawn off and not flipped from. */
  state: boolean | null | undefined;
  /** Why the switch cannot be flipped now. It is drawn dimmed with this as its tip and a flip sends nothing. */
  unavailable?: string | null;
  checked?: never;
  onChange?: never;
  disabled?: never;
}

/**
 * Props for {@link Switch}: `checked`, `onChange(next)`, optional `disabled`
 * and `id`, and exactly one name. A switch always has a name: a visible `label`
 * drawn beside it, or an `aria-label` where the row it sits in shows its own
 * label text. Useful for letting the operator turn a widget option on or off.
 * Taken by {@link Switch}.
 *
 * @category Form
 */
export type SwitchProps = SwitchBaseProps &
  (PlainSwitchProps | CommandedSwitchProps) &
  (
    | {
        /** The visible name, drawn beside the track. Give this or `aria-label`, never both. */
        label: string;
        "aria-label"?: never;
      }
    | {
        label?: never;
        /** The accessible name, for a switch whose row already shows its label text. Give this or `label`, never both. */
        "aria-label": string;
      }
  );

/**
 * An on/off toggle for one setting, which takes effect as it is flipped; inside
 * a form with a save bar (see {@link useModalSaveBar}) the change waits for Save
 * like any other field.
 * Useful for letting the operator turn a widget option on or off. Used by the
 * configuration forms of the warp control and the rendezvous widget. It is
 * a native checkbox drawn as a sliding track, keyboard-operable with Space and
 * with the focus ring drawn on the track.
 *
 * @category Form
 */
export function Switch(props: SwitchProps) {
  if (props.command) {
    return <CommandedSwitch {...props} command={props.command} />;
  }
  return <PlainSwitch {...props} />;
}

function PlainSwitch({
  checked,
  onChange,
  label,
  disabled,
  id,
  "aria-label": ariaLabel,
}: SwitchBaseProps &
  PlainSwitchProps & { label?: string; "aria-label"?: string }) {
  return (
    <SwitchLabel $disabled={disabled}>
      <SwitchInput
        type="checkbox"
        id={id}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label ? undefined : ariaLabel}
      />
      <SwitchTrack $checked={checked} $disabled={disabled}>
        <SwitchThumb $checked={checked} $disabled={disabled} />
      </SwitchTrack>
      {label && <SwitchText>{label}</SwitchText>}
    </SwitchLabel>
  );
}

/* Flips to the opposite of the state the vessel reports, whatever became of an earlier flip. */
function CommandedSwitch({
  command,
  state,
  unavailable,
  label,
  id,
  "aria-label": ariaLabel,
}: SwitchBaseProps &
  CommandedSwitchProps & { label?: string; "aria-label"?: string }) {
  const input = useCommandInput({ command, unavailable });
  const on = state === true;
  const flippable = typeof state === "boolean";
  return (
    <Tooltip text={input.tip}>
      <SwitchLabel $disabled={input.inert}>
        <SwitchInput
          type="checkbox"
          id={id}
          checked={on}
          aria-disabled={input.inert || undefined}
          onChange={() => {
            if (flippable) input.send(!state);
          }}
          aria-label={label ? undefined : ariaLabel}
        />
        <SwitchTrack $checked={on} $disabled={input.inert} {...input.edge}>
          <SwitchThumb $checked={on} $disabled={input.inert} />
        </SwitchTrack>
        {label && <SwitchText>{label}</SwitchText>}
        <SwitchWord aria-hidden="true">{input.word}</SwitchWord>
        <LiveRegion visuallyHidden>{input.announce}</LiveRegion>
      </SwitchLabel>
    </Tooltip>
  );
}

const SwitchLabel = styled.label<{ $disabled?: boolean }>`
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--gap-glyph-control);
  cursor: ${({ $disabled }) => ($disabled ? "not-allowed" : "pointer")};
  user-select: none;
  opacity: ${({ $disabled }) => ($disabled ? 0.5 : 1)};

  @media (pointer: coarse) {
    /* Expand tap target to 44px tall without enlarging the visual track. */
    min-height: var(--touch-target);
    padding: var(--inset-switch-touch);
  }
`;

/*
 * A disabled switch keeps the colours of its state, so one held on reads as on;
 * the label's reduced opacity is what marks it disabled.
 */
const SwitchTrack = styled.div<{ $checked: boolean; $disabled?: boolean }>`
  width: 28px;
  height: 14px;
  /* --radius-pill keeps the stadium shape through a height change. */
  border-radius: var(--radius-pill);
  background: ${({ $checked }) => ($checked ? "var(--color-go-mark)" : "var(--color-surface-raised)")};
  border: 1px solid ${({ $checked }) => ($checked ? "var(--color-go-mark)" : "var(--color-border-strong)")};
  position: relative;
  flex-shrink: 0;
  transition: background var(--duration-base), border-color var(--duration-base);
  ${commandEdge}
`;

/* Drawn over the end of the switch, taking no width, so a press never moves the row. */
const SwitchWord = styled.span`
  position: absolute;
  inset-inline-end: 0;
  top: 50%;
  transform: translateY(-50%);
  padding-inline: var(--gap-related-dense);
  background: var(--color-surface-sunken);
  pointer-events: none;
  &:empty {
    display: none;
  }
  font-size: var(--font-size-caption);
  color: var(--color-text-muted);
  letter-spacing: 0.08em;
`;

/* The input is invisible and sizeless, so its keyboard focus is drawn on the
   track it sits beside. */
const SwitchInput = styled.input`
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;

  &:focus-visible + ${SwitchTrack} {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;

const SwitchThumb = styled.div<{ $checked: boolean; $disabled?: boolean }>`
  position: absolute;
  /* Measured inside the border: the track is border-box, so its 1px border leaves a 26 by 12 box, and 2px on every side centres the 8px thumb at either end. */
  top: 2px;
  left: ${({ $checked }) => ($checked ? "16px" : "2px")};
  width: 8px;
  height: 8px;
  border-radius: var(--radius-circle);
  background: ${({ $checked }) => ($checked ? "var(--color-accent-fg)" : "var(--color-text-faint)")};
  transition: left var(--duration-base), background var(--duration-base);
`;

const SwitchText = styled.span`
  font-size: var(--font-size-caption);
  color: var(--color-text-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;
