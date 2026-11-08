import type { Tone } from "@ksp-gonogo/sitrep-sdk";
import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";
import styled, { css } from "styled-components";
import { Button__Body, filledLook, IconButton__Body } from "./ButtonBody";
import {
  buttonTipText,
  reasonedDisabled,
  swallowPress,
  withButtonTip,
} from "./buttonTip";
import {
  CommandedButton,
  type CommandedButtonProps,
  CommandedIconButton,
  CommandedIconToggle,
  type CommandedToggleProps,
  isControl,
} from "./CommandButton/CommandedButton";
import { focusRing } from "./focusRing";
import { HeldFigure } from "./HeldMark";
import { PlainButton } from "./PlainButton";
import type { ReckoningMarking } from "./readingCurrency";
import type { PredictedOutcome } from "./SendStatus/predictedOutcome";
import { TONE_MARK, TONE_ON_STATUS, TONE_STATUS, TONE_TEXT } from "./tone";

/**
 * How much a button asks to be pressed: `default` is the ordinary raised
 * control, `primary` the one commit action of a group, filled in its tone,
 * `ghost` the quiet secondary one beside it, and `text` no chrome at all, for
 * words that are themselves the control (a name that renames on click): it
 * takes its colour and type from the text around it. An underlined action
 * that reads as part of a sentence is a {@link TextButton} instead. Set with
 * the `variant` prop of {@link Button}.
 * Useful for telling the operator which control in a group is the main action
 * and which are secondary.
 *
 * @category Button
 */
export type ButtonVariant = "default" | "primary" | "ghost" | "text";

/**
 * The state a button's action puts things in. `nogo` is the destructive tone,
 * `warn` an action that needs attention; `neutral` has no state. Useful for
 * telling the operator how serious pressing a button is. Set with the `tone`
 * prop of {@link Button}.
 *
 * @category Button
 */
export type ButtonTone = Extract<Tone, "neutral" | "go" | "warn" | "nogo">;

/**
 * `sm` for dense rows, `md` otherwise; both sizes keep the kit's one control
 * height, and only the type and padding change. Set with the `size` prop of
 * {@link Button}.
 * Useful for fitting a button into a dense row or a roomier form.
 *
 * @category Button
 */
export type ButtonSize = "sm" | "md";

/**
 * The props of {@link Button}: those of a plain button, or, when `command` is
 * set, those of a button that sends it.
 * Useful for describing a control the operator presses.
 *
 * @category Button
 */
export type ButtonProps = PlainButtonProps | CommandedButtonProps;

/**
 * A native button's attributes, plus how prominent it is, what its action
 * does, how large it is and, for a toggle, whether it is pressed. Taken by
 * {@link Button} when it has no `command`.
 *
 * @category Button
 */
export interface PlainButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Set `command` to make the button send a command; see {@link CommandedButtonProps}. */
  command?: undefined;
  /** How prominent the button is. Defaults to `default`. */
  variant?: ButtonVariant;
  /**
   * What pressing the button does, as a status colour: `nogo` for a destructive
   * action, `warn` for one that needs attention. Defaults to `go` for a primary
   * button and `neutral` otherwise.
   */
  tone?: ButtonTone;
  /** Defaults to `md`. */
  size?: ButtonSize;
  /**
   * Makes the button a toggle: sets `aria-pressed` and, while true, draws the
   * one pressed look, filled in the tone's status colour. A pressed button
   * with no state of its own reads as on, so a neutral one fills in go.
   */
  pressed?: boolean;
  /**
   * The predicted result of pressing, drawn as a dashed edge in the button's own
   * border so its size does not change: `held` in the go colour with dashes, and
   * `at-risk` in the warning colour with the same dashes. It is drawn apart from the
   * keyboard focus ring, so both show at once, and a disabled button keeps its
   * disabled look. The tooltip says what the prediction is.
   */
  predictedOutcome?: PredictedOutcome;
  /**
   * Why the button is disabled, shown as its tip. With `disabled`, the button
   * is `aria-disabled` rather than natively disabled, so it keeps keyboard
   * focus and the tip can be reached; pressing it does nothing. A disabled
   * button with no reason says nothing about why, so give one wherever the
   * reason is known.
   */
  disabledReason?: string;
  /**
   * Marks the state the button shows as held or modelled, for a toggle whose
   * state comes from an old or late reading. The button stays pressable: the
   * label takes the kit's held mark, and the mark's words (hand it
   * {@link derivedMarking}, with what the press does added) are spoken after
   * the label and shown as its tip, so nothing is drawn beside it.
   */
  marked?: ReckoningMarking | null;
}

/**
 * The kit's button: one family whose `variant` says how prominent it is and
 * whose `tone` says what its action does. Useful for any action the operator
 * takes on this screen, such as saving a form or dismissing a banner. Used by
 * the source offline banner and the command block. Write the label in sentence
 * case; uppercase belongs to headings and state tokens. It takes no alignment
 * of its own: where it sits in a row is the caller's layout. The ref reaches
 * the `button` element. Its `type` is `"button"` unless the caller passes
 * `"submit"`, so a press inside a form submits nothing by default.
 *
 * Its content is a centred flex row, so an icon beside the word centres on it
 * rather than sitting on the text baseline.
 *
 * Given a `command`, it sends that command and shows what became of the press.
 * Every command control draws the same seven states:
 *
 * - rest: the label, with a `confirmLabel` it arms first and sends on the
 *   second press
 * - sent: "SENT" until the mod answers the press
 * - refused: the label becomes "Refused" (`refusedLabel`) and the reason is the
 *   tip and the accessible name
 * - no reply: the label becomes "No reply" (`lostLabel`), because the game
 *   decided nothing and the command may have run
 * - unavailable: the reason the caller gave in `unavailable`, dimmed with a
 *   solid edge; a press sends nothing
 * - stream down: not connected to the mod, dimmed with a dotted edge; a press
 *   sends nothing
 * - blocked: the game has said it will refuse the command, dimmed with a dashed
 *   warning edge; a press sends nothing and shows why
 *
 * The three dimmed states differ by edge, and the reason is each one's tip and
 * accessible description, read after the control's own name. A toggle keeps its on and off word in every state and shows
 * a refusal or a missing reply as a warning edge instead. Reach the same states
 * from your own markup with {@link useCommandControl}.
 *
 * @example
 * ```tsx
 * import { Button, CheckIcon, Cluster } from "@ksp-gonogo/ui-kit";
 *
 * function SaveBar(props: { onCancel: () => void; onSave: () => void }) {
 *   return (
 *     <Cluster justify="end">
 *       <Button variant="ghost" onClick={props.onCancel}>Cancel</Button>
 *       <Button variant="primary" onClick={props.onSave}>
 *         <CheckIcon />
 *         Save
 *       </Button>
 *     </Cluster>
 *   );
 * }
 * ```
 *
 * @category Button
 * @categoryDescription Button
 * Buttons for things that happen on this screen: plain, icon and text buttons,
 * toggles, groups, and a button that fits its label to the space it has. A
 * button that sends a command to the game is a {@link Button}.
 *
 * A button that is a glyph alone, or whose `aria-label` says more than its words
 * do, shows that name as a tip on hover and keyboard focus; a button whose words
 * are the whole story shows none. A disabled button given a `disabledReason`
 * shows the reason.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(props, ref) {
    if (props.command !== undefined) return <CommandedButton {...props} />;
    return <PlainButton ref={ref} {...props} />;
  },
);
/**
 * A subtle, underlined link-style `button` for a tertiary action inside copy
 * (such as "Clear all" in a list row). Useful for an action that should read as
 * part of the sentence around it. Used by the maneuver node list and the ship
 * diagram. It renders a native `button` and takes every prop that element does.
 * For a paired Cancel and Confirm row, use a ghost {@link Button} beside a
 * primary one. For words that are themselves the control and should keep the
 * surrounding text's colour and type, use a {@link Button} with
 * `variant="text"` instead.
 *
 * @category Button
 */
export const TextButton = styled.button`
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: var(--font-size-compact);
  font-family: inherit;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  transition: color var(--duration-fast);

  @media (hover: hover) {
    &:hover {
      color: var(--color-text-primary);
    }
  }
  ${focusRing}
  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

/**
 * Props for {@link IconButton}. Any other `button` attribute passes through.
 * Useful for giving a control that is a glyph alone its accessible name and
 * its press handler. Used by {@link IconButton}.
 *
 * @category Button
 */
export type IconButtonProps =
  | PlainIconButtonProps
  | (Omit<CommandedButtonProps, "children" | "aria-label" | "tone"> & {
      /** The glyph. */
      children: ReactNode;
      /** The control's name, which is also its tip. */
      "aria-label": string;
    })
  | (Omit<CommandedToggleProps, "children" | "aria-label"> & {
      /** The glyph, shown as it is and replaced by the kit's send arrow while the press is unanswered. */
      children: ReactNode;
      /** The control's name, which is also its tip. */
      "aria-label": string;
    });

/**
 * Props for {@link IconButton} with no command. Any other `button` attribute
 * passes through. Useful for giving a control that is a glyph alone its
 * accessible name and its press handler.
 *
 * @category Button
 */
export interface PlainIconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Set `command` to make the button send a command; give it `state` too if the command sets a value. */
  command?: undefined;
  /** Makes the button a toggle: sets `aria-pressed` and, while true, draws the pressed look. */
  pressed?: boolean;
  /** Why the button is disabled, shown as its tip. As for {@link Button}. */
  disabledReason?: string;
}

/**
 * An icon-only `button`: the glyph alone at rest, with a fill and an edge
 * drawn around it under the pointer. Useful for compact controls whose meaning
 * an icon carries, such as closing a panel. Used by the
 * maneuver node rows and the connection settings. Give it an `aria-label`,
 * since the icon inside is decorative; the name is also its tip, so a glyph is
 * never unexplained. As a toggle, with `pressed`, it sets
 * `aria-pressed` and takes the filled pressed look while pressed. The ref
 * reaches the `button` element. Under a coarse pointer it grows to a 44px touch
 * target.
 *
 * @example
 * ```tsx
 * import { CloseIcon, IconButton } from "@ksp-gonogo/ui-kit";
 *
 * function CloseButton(props: { onClose: () => void }) {
 *   return (
 *     <IconButton aria-label="Close" onClick={props.onClose}>
 *       <CloseIcon />
 *     </IconButton>
 *   );
 * }
 * ```
 *
 * @category Button
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(props, ref) {
    if (props.command !== undefined) {
      const { command } = props;
      const sets =
        "kind" in command && command.kind === "value"
          ? true
          : isControl(command) && command.toggleView !== null;
      if (sets) {
        const { children, ...toggle } = props as CommandedToggleProps & {
          children: ReactNode;
        };
        return <CommandedIconToggle {...toggle} icon={children} />;
      }
      return <CommandedIconButton {...(props as CommandedButtonProps)} />;
    }
    const { pressed, disabledReason, command: _command, ...rest } = props;
    const reasoned = reasonedDisabled(rest.disabled, disabledReason);
    const tip = buttonTipText({
      label: rest["aria-label"],
      children: rest.children,
      disabledReason: reasoned ? disabledReason : undefined,
    });
    const { disabled, onClick, ...passed } = rest;
    return withButtonTip(
      <IconButton__Body
        ref={ref}
        aria-pressed={pressed}
        {...passed}
        disabled={reasoned ? undefined : disabled}
        {...(reasoned ? { "aria-disabled": true } : {})}
        onClick={reasoned ? swallowPress : onClick}
      />,
      tip,
      reasoned,
    );
  },
);

export { Button__Body, filledLook };
