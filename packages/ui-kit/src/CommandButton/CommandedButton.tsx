import {
  type AnyBoundCommand,
  argsOf,
  type BoundCommand,
  bindCommand,
  type UseCommandResult,
  type ValueCommand,
} from "@ksp-gonogo/sitrep-sdk";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useEffect } from "react";
import styled, { css, keyframes } from "styled-components";
import type { ButtonVariant } from "../Button";
import { Button__Body, IconButton__Body } from "../ButtonBody";
import { useRailAnnounces } from "../CommandDelay/railAnnouncer";
import { FitLabel } from "../FitLabelButton";
import { SendIcon } from "../Icons";
import { LiveRegion } from "../LiveRegion";
import { PlainButton } from "../PlainButton";
import { ReservedText } from "../ReservedText";
import type { ReckoningMarking } from "../readingCurrency";
import { describeSendStatus } from "../SendStatus/describeSendStatus";
import { predictedOutcomeOf } from "../SendStatus/predictedOutcome";
import { Tooltip } from "../Tooltip";
import {
  type BoundControlCommand,
  type CommandButtonHandle,
  type CommandButtonSize,
  type CommandButtonTone,
  type CommandControlState,
  FOUND_WORD,
  LOST_WORD,
  REFUSED_WORD,
  SENT_WORD,
  STREAM_DOWN_TIP,
  standingGate,
  useCommandControl,
} from "./commandControl";
import type { CommandToggle, ToggleState } from "./toggle";

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "type" | "children" | "aria-pressed" | "title" | "disabled"
>;

/**
 * What a command input takes in its `command` prop: a command made with `with`
 * or `commandSet`, a handle whose arguments are all optional (a press of the
 * command with no arguments), or the control of a {@link useCommandControl} that
 * a bound key or serial input presses too.
 *
 * @category CommandButton
 */
// biome-ignore lint/suspicious/noExplicitAny: a control or handle of any command's argument and reply types
export type CommandInput =
  | AnyBoundCommand
  | CommandButtonHandle<any, any>
  | CommandControlState<any>;

/** Whether `command` is a control already running its own hook, which a bound key may press as well. */
export function isControl<Command extends object>(
  command: Command,
): command is Extract<Command, { press: unknown }> {
  return "press" in command && typeof command.press === "function";
}

/** The bound command a handle or bound command stands for. */
function boundOf(
  command: AnyBoundCommand | CommandButtonHandle<unknown, unknown>,
): BoundControlCommand {
  if ("kind" in command) return command;
  return bindCommand(command, undefined);
}

/**
 * Props for a {@link Button} given a command: the command it sends, its words
 * for each state and the confirm wording. Any other native button attribute is
 * passed through, except `onClick` and `disabled`, which the command decides.
 * Useful for naming the command a button sends and how the operator confirms it.
 * Taken by {@link Button} when it has a `command`.
 *
 * @category CommandButton
 */
export interface CommandedButtonProps extends NativeButtonProps {
  /** The command to send when the button is pressed. */
  command: CommandInput;
  /**
   * What the control says on hover and keyboard focus while it is at rest or
   * armed, in the kit's tip. An outcome's own sentence, the caller's
   * `unavailable` reason or the game's reason for refusing replaces it while
   * one stands. It is not the accessible name: give `aria-label` for that.
   */
  tip?: string;
  /** The resting label. */
  children: ReactNode;
  /**
   * Why the control cannot be pressed now, for what a command's own declaration
   * cannot know, such as a reading that has not arrived. The control is drawn
   * dimmed with a solid edge, apart from the dashed warning edge the game's own
   * refusal gets, with this as its tip and accessible description, and a press
   * sends nothing. Null or absent when it can be pressed. A control given as a
   * `useCommandControl` states its own.
   */
  unavailable?: string | null;
  /**
   * Why the game is likely to refuse this command, for what the command's own
   * declaration cannot know. The control stays pressable and a press is sent;
   * the reason is its tip and its edge shows the command may be refused, and the
   * game decides on arrival. Null or absent when nothing says it will be
   * refused. A control given as a `useCommandControl` states its own.
   */
  advise?: string | null;
  /**
   * The armed label. Supplying it makes this an arm-then-confirm control: the
   * first click puts it in the armed phase, the second dispatches, and an armed
   * control left alone returns to rest after {@link ARM_TIMEOUT_MS}. Omit it for
   * a control that dispatches on one click.
   *
   * Arm anything irreversible, and anything that spends career funds.
   */
  confirmLabel?: ReactNode;
  /** The word shown in place of the label after the game refuses the command. Defaults to "Refused". */
  refusedLabel?: ReactNode;
  /**
   * The word shown in place of the label after a dispatch got no reply.
   * Defaults to "No reply": not "failed" and not "refused", neither of which is
   * known.
   */
  lostLabel?: ReactNode;
  /**
   * The label for a command this control lost that has since replied.
   * Defaults to "Found", with the whole sentence on the accessible name and
   * title. Not "Confirmed": the operator was told to give up on it.
   */
  foundLabel?: ReactNode;
  /**
   * The accessible name while the control cannot be pressed, for a control whose
   * resting name would mislead then. Omit it and the accessible name stays the
   * control's own name, with the reason as its description, read after the name.
   */
  blockedAriaLabel?: string;
  /**
   * The armed phase's accessible name, for a control whose resting
   * `aria-label` says more than its visible word ("Hire Desdin Kerman for
   * 30,000 funds"). Omit it and the visible confirm wording is the accessible
   * name, never the resting label, since the next press means something
   * different.
   */
  confirmAriaLabel?: string;
  /** The sent phase's accessible name, for a control whose resting name says more than its visible word. Defaults to the command's label followed by "sent, not yet received". */
  sentAriaLabel?: string;
  /**
   * Whether this control's command is currently in effect, for a control that
   * represents state as well as acting on it: an activated strategy. Sets
   * `aria-pressed` and the pressed fill. Leave it undefined for a control that
   * only acts.
   */
  pressed?: boolean;
  /** How much the control asks to be pressed at rest. As for {@link Button}. */
  variant?: ButtonVariant;
  /**
   * The tone of the fill while `pressed`, and of the resting fill for a
   * `primary` control. Defaults to `neutral`.
   */
  tone?: CommandButtonTone;
  /**
   * Shown in place of the word when the word does not fit the control's width,
   * measured against the control itself and following resizes, for a control in
   * a narrow cell. The word stays the accessible name in both states. Needs a
   * plain-text label and, when set, `confirmLabel`.
   */
  icon?: ReactNode;
  /** Shown in place of the confirm word when it does not fit. Defaults to {@link CommandedButtonProps.icon}. */
  confirmIcon?: ReactNode;
  /**
   * Called with the control's press while a click on it would do something
   * (not while it is in flight) and with `null` when it would not, for a
   * caller that lets an input (a key, a gamepad button or a serial device
   * bound to this control) press it from elsewhere. The press takes no
   * arguments and does what a click does: with a `confirmLabel` the first
   * press arms and the second dispatches, and a control with none dispatches
   * at once.
   */
  onPressReady?: (press: (() => void) | null) => void;
  /** Defaults to `md`. */
  size?: CommandButtonSize;
  /** Tone for the armed phase. Defaults to `go`: confirm reads as commit. */
  confirmTone?: CommandButtonTone;
}

/**
 * A button given a command: it sends the command and shows what became of it,
 * at rest, armed (with a `confirmLabel`), sent, refused, lost (no reply came in
 * time), found (a lost command has since replied), or unable to be pressed
 * (unavailable for the caller's reason, stream down, or blocked by the game's
 * refusal, told apart by edge). Rendered by {@link Button} when it has a
 * `command`.
 */
export function CommandedButton(props: CommandedButtonProps) {
  const { command, unavailable, advise, ...rest } = props;
  if (isControl(command)) {
    return <CommandedButtonFace {...rest} control={command} />;
  }
  return (
    <OwnedCommandedButton
      {...rest}
      command={command}
      unavailable={unavailable}
      advise={advise}
    />
  );
}

/**
 * An icon button given a command: the glyph stands for the word, and the kit's
 * send arrow stands in for it while the press is unanswered, so the box keeps
 * its size. Rendered by {@link IconButton} when it has a `command`.
 */
export function CommandedIconButton(props: CommandedButtonProps) {
  const { command, unavailable, advise, ...rest } = props;
  if (isControl(command)) {
    return <CommandedButtonFace {...rest} glyph control={command} />;
  }
  return (
    <OwnedCommandedButton
      {...rest}
      glyph
      command={command}
      unavailable={unavailable}
      advise={advise}
    />
  );
}

function OwnedCommandedButton({
  command,
  unavailable,
  advise,
  ...rest
}: Omit<CommandedButtonProps, "command"> & {
  command: BoundCommand | CommandButtonHandle<unknown, unknown>;
  glyph?: boolean;
}) {
  const control = useCommandControl({
    command: boundOf(command),
    unavailable,
    advise,
  });
  return <CommandedButtonFace {...rest} control={control} />;
}

function CommandedButtonFace({
  control,
  glyph = false,
  children: label,
  confirmLabel,
  refusedLabel = REFUSED_WORD,
  lostLabel = LOST_WORD,
  foundLabel = FOUND_WORD,
  confirmAriaLabel,
  sentAriaLabel,
  blockedAriaLabel,
  pressed,
  variant = "default",
  tone = "neutral",
  icon,
  confirmIcon,
  onPressReady,
  size = "md",
  confirmTone = "go",
  tip,
  "aria-label": ariaLabel,
  ...rest
}: Omit<CommandedButtonProps, "command" | "unavailable"> & {
  control: CommandControlState;
  /** Draws the button as an icon button does: the glyph alone at rest, edged and filled under the pointer. */
  glyph?: boolean;
}) {
  const {
    phase,
    isSent,
    isArmed,
    isRefused,
    isLost,
    isFound,
    isBlocked,
    isUnavailable,
    isAdvised,
    adviceText,
    isOffline,
    refusalText,
    foundText,
    lossText,
    hasUnconfirmed,
    hasFailure,
    press,
    command,
  } = control;
  const handle = command.handle;
  const args = command.members ? undefined : argsOf(command);
  const commandLabel = command.options.label;

  const hasConfirmStep = confirmLabel !== undefined;
  const sentSentence = commandLabel
    ? `${commandLabel} sent, not yet received`
    : "Sent, not yet received";
  useEffect(() => {
    if (!onPressReady) return;
    onPressReady(() => press(hasConfirmStep));
    return () => onPressReady(null);
  }, [onPressReady, press, hasConfirmStep]);

  const resolveBody = (): ReactNode => {
    if (glyph) {
      if (isSent) return <SendIcon aria-hidden="true" />;
      if (isArmed) return confirmIcon ?? icon ?? label;
      return label;
    }
    if (isSent) return SENT_WORD;
    if (isRefused) return refusedLabel;
    if (isLost) return lostLabel;
    if (isFound) return foundLabel;
    if (isArmed) return confirmLabel;
    return label;
  };
  const resolved = resolveBody();
  const fitWord = icon !== undefined && typeof resolved === "string";
  /* A word standing in for a label that cannot hold it (a node label, or a narrow cell) is held to one line and clipped, so it never wraps and grows the control. */
  const clipsWord =
    !glyph && !fitWord && typeof resolved === "string" && resolved !== label;
  const body = fitWord ? (
    <FitLabel label={resolved} icon={isArmed ? (confirmIcon ?? icon) : icon} />
  ) : clipsWord ? (
    <CommandButton__Word>{resolved}</CommandButton__Word>
  ) : (
    resolved
  );
  /*
   * A control keeps the width of its widest word (resting, confirm or SENT) in
   * every state, so pressing it never reflows the row it sits in. Only plain-text
   * labels can be measured this way; a node label sizes itself as before.
   */
  /* Every word the control can show in place of its label: the widest sets the width in every phase, so an outcome never resizes the control. */
  const words = [confirmLabel, SENT_WORD, refusedLabel, lostLabel, foundLabel];
  const reserve =
    !glyph &&
    icon === undefined &&
    typeof label === "string" &&
    words.every((w) => w === undefined || typeof w === "string");
  const widest = (words as (string | undefined)[])
    .filter((w): w is string => w !== undefined)
    .reduce((a, b) => (b.length > a.length ? b : a), SENT_WORD);

  // A mounted rail announces every outcome of the commands it holds, so this control's own region stays quiet beside one only when its handle is one of them.
  const railed = useRailAnnounces() && handle.railed === true;
  const outcome = railed
    ? null
    : isRefused
      ? refusalText
      : isLost
        ? lossText
        : isFound
          ? foundText
          : isSent
            ? sentSentence
            : null;

  const filled = pressed === true || isArmed || isRefused;
  const drawnTone = commandTone({
    restTone: variant === "primary" ? tone : "neutral",
    filled,
    isRefused,
    isFound,
    isArmed,
    confirmTone,
    tone,
  });

  /* The game's refusal in advance, apart from a reason the caller gave. */
  const gated = isBlocked && !isUnavailable;
  // A box button draws the game's refusal through its own blocked style, so only a glyph needs the attribute.
  const commandEdge = gated
    ? glyph
      ? "blocked"
      : undefined
    : isLost || (glyph && (isRefused || hasUnconfirmed || hasFailure))
      ? "warn"
      : undefined;
  const Body = glyph ? CommandGlyph__Body : CommandButton__Body;
  const sendStatus = handle.sendStatus;
  const restTip = [
    tip,
    adviceText,
    sendStatus === undefined ? null : describeSendStatus(sendStatus),
  ]
    .filter(Boolean)
    .join("\n");
  const tipText = isOffline
    ? [tip, STREAM_DOWN_TIP].filter(Boolean).join("\n")
    : restTip || undefined;

  return (
    <>
      <Tooltip
        text={
          foundText ??
          refusalText ??
          lossText ??
          (isSent ? sentSentence : tipText)
        }
      >
        <Body
          type="button"
          data-command-edge={commandEdge}
          $tone={drawnTone}
          $variant={variant}
          $fit={fitWord}
          $size={size}
          $pressed={filled}
          $armed={isArmed}
          $blocked={gated}
          aria-pressed={pressed}
          // aria-disabled, not disabled, so the control keeps focus while the outcome lands on it and the tip can be reached.
          aria-disabled={isBlocked || isOffline || undefined}
          data-unconfirmed={hasUnconfirmed ? "true" : undefined}
          data-failed={hasFailure ? "true" : undefined}
          data-command-phase={phase}
          data-stream={isOffline ? "down" : undefined}
          data-predicted={
            gated
              ? undefined
              : (predictedOutcomeOf(sendStatus) ??
                (isAdvised ? "at-risk" : undefined))
          }
          // A diagnostic hook only: an undetermined gate renders as an ordinary control.
          data-gate={
            gated
              ? "blocked"
              : isAdvised
                ? "advised"
                : standingGate(handle, args)?.undetermined
                  ? "undetermined"
                  : undefined
          }
          /*
           * The accessible name tracks the phase: an outcome's full sentence while
           * it stands, and for armed and sent the visible wording rather than
           * the resting label, which describes a state the control has left.
           */
          aria-label={
            (isRefused
              ? (refusalText ?? undefined)
              : isLost
                ? (lossText ?? undefined)
                : isFound
                  ? (foundText ?? ariaLabel)
                  : isBlocked
                    ? (blockedAriaLabel ?? ariaLabel)
                    : isSent
                      ? (sentAriaLabel ?? sentSentence)
                      : isArmed
                        ? confirmAriaLabel
                        : ariaLabel) ?? (fitWord ? resolved : undefined)
          }
          onClick={() => press(confirmLabel !== undefined)}
          data-rest-label={reserve ? label : undefined}
          data-armed-label={reserve ? widest : undefined}
          {...rest}
        >
          {reserve ? <CommandButton__Face>{body}</CommandButton__Face> : body}
        </Body>
      </Tooltip>
      {/* Mounted with the control, so an outcome lands in a region assistive tech is already watching. */}
      <LiveRegion visuallyHidden>{outcome}</LiveRegion>
    </>
  );
}

/**
 * Props for a {@link ToggleButton} given a command: the command it sends, the
 * state it shows and what it is called. Any other native button attribute is
 * passed through, except `onClick` and `disabled`, which the command decides.
 * Useful for a switch the operator flips under signal delay, such as SAS or an
 * action group. A toggle keeps its on and off word in every state: a refusal or
 * a missing reply shows as a warning edge, the game's refusal in advance as a
 * dashed warning edge, and the stream to the mod being down as a dotted edge.
 * Taken by {@link ToggleButton} when it has a `command`.
 *
 * @category CommandButton
 */
export interface CommandedToggleProps extends NativeButtonProps {
  /**
   * The command a press sends, made with `toArgs` on a `useCommand` handle and
   * given `true` to switch on and `false` to switch off. Or the control of a
   * {@link useCommandControl} that was given a `toggle`, which a bound key or
   * serial input may press as well.
   */
  // biome-ignore lint/suspicious/noExplicitAny: a command of any argument and reply types
  command: ValueCommand<boolean, any, any> | CommandControlState<any>;
  /** The state as the vessel last reported it, uncoerced: nothing yet is a third state, not off. Not used with a control. */
  state?: ToggleState;
  /** What the control is called in the sentences it speaks ("RCS sent, not yet received"). Not used with a control. */
  name?: string;
  /**
   * Why the control cannot be pressed now. It is drawn dimmed with a solid edge
   * and this as its tip, and a press sends nothing. Null or absent when it can
   * be pressed. Not used with a control.
   */
  unavailable?: string | null;
  /**
   * Why the game is likely to refuse this command, for what the command's own
   * declaration cannot know. The control stays pressable and a press is sent;
   * the reason is its tip and its edge shows the command may be refused, and the
   * game decides on arrival. Null or absent when nothing says it will be
   * refused. Not used with a control.
   */
  advise?: string | null;
  /** The fill while on. Defaults to `go`. */
  tone?: "go" | "nogo" | "warn";
  /** Defaults to `md`. */
  size?: CommandButtonSize;
  /**
   * The word the control shows for a state, or a function of the state shown
   * that returns it. Not used with a control, which carries its own words.
   */
  children?: ReactNode | ((shown: ToggleState) => string);
  /** Stands in the word's place until the press is answered. "SENT" is still a word, since no icon says it. */
  icon?: ReactNode;
  /** What the control says on hover and keyboard focus. An outcome's own sentence replaces it while one stands. */
  tip?: string;
  /** The word shown in place of the state until the mod answers the press. Defaults to "SENT". Not used with a control. */
  sentWord?: string;
  /** Which of the handle's in-flight rows are this control's, where one command serves several controls. Not used with a control. */
  rows?: CommandToggle["rows"];
  /** What an arrived command does to a state its args do not set outright. Not used with a control. */
  modelled?: CommandToggle["modelled"];
  /** The mark the state's own reading wears, when it is held or late. Not used with a control. */
  marking?: ReckoningMarking | null;
}

/**
 * A toggle given a command: it shows the state the vessel reports, a press
 * sends the command that sets the opposite, and while that press is unanswered
 * it shows "SENT", then the state again, marked held while the command waits at
 * a relay and marked modelled while it is predicted to have arrived. A second
 * press is always sent. Rendered by {@link ToggleButton} when it has a
 * `command`.
 */
export function CommandedToggle(props: CommandedToggleProps) {
  const { command, ...rest } = props;
  if (isControl(command)) {
    return <CommandedToggleFace {...rest} control={command} />;
  }
  return <OwnedCommandedToggle {...rest} command={command} />;
}

/**
 * An icon toggle given a command: the glyph stands for the word until the press
 * is answered, and the kit's send arrow stands in for it meanwhile. Rendered by
 * {@link IconButton} when it has a `command` that sets a value.
 */
export function CommandedIconToggle(props: CommandedToggleProps) {
  const { command, ...rest } = props;
  if (isControl(command)) {
    return <CommandedToggleFace {...rest} glyph control={command} />;
  }
  return <OwnedCommandedToggle {...rest} glyph command={command} />;
}

function OwnedCommandedToggle({
  command,
  state,
  name,
  unavailable,
  advise,
  children,
  sentWord,
  rows,
  modelled,
  marking,
  glyph,
  ...rest
}: Omit<CommandedToggleProps, "command"> & {
  glyph?: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: a command of any argument and reply types
  command: ValueCommand<boolean, any, any>;
}) {
  const wordOf = (shown: ToggleState): string =>
    typeof children === "function"
      ? children(shown)
      : typeof children === "string"
        ? children
        : "";
  const control = useCommandControl({
    command: {
      kind: "bound",
      handle: command.handle,
      args: undefined,
      options: command.options,
    },
    toggle: {
      state,
      name: name ?? "",
      word: wordOf,
      /* The on and off words only: the word for a state not yet read is a one-off the width is not held for. */
      words: [...new Set([wordOf(true), wordOf(false)])],
      sentWord,
      rows,
      modelled,
      marking,
      unavailable,
      // Nothing is sent while the state is unread: there is no opposite of it.
      args: (base) =>
        base === null || base === undefined
          ? undefined
          : command.toArgs(!(typeof base === "number" ? base > 0 : base)),
    },
    advise,
  });
  return <CommandedToggleFace {...rest} glyph={glyph} control={control} />;
}

function CommandedToggleFace({
  control,
  glyph = false,
  tone = "go",
  size = "md",
  icon,
  tip,
  "aria-label": ariaLabel,
  ...rest
}: Omit<
  CommandedToggleProps,
  | "command"
  | "state"
  | "name"
  | "unavailable"
  | "advise"
  | "children"
  | "sentWord"
  | "rows"
  | "modelled"
  | "marking"
> & { control: CommandControlState; glyph?: boolean }) {
  const {
    phase,
    isOffline,
    isRefused,
    isLost,
    isBlocked,
    isUnavailable,
    isAdvised,
    adviceText,
    refusalText,
    lossText,
    toggleView,
    hasUnconfirmed,
    hasFailure,
    press,
  } = control;
  if (!toggleView) return null;
  const { marking, sentence } = toggleView;
  // A held or modelled command's mark carries its own sentence, so the tip beside it stays free.
  const markCarriesIt =
    toggleView.confirmation === "held" ||
    toggleView.confirmation === "modelled";
  const toggleTip = isOffline
    ? STREAM_DOWN_TIP
    : (isBlocked && !isUnavailable) || isRefused
      ? refusalText
      : isLost
        ? lossText
        : ((markCarriesIt ? null : sentence) ??
            [tip, adviceText].filter(Boolean).join("\n")) ||
          undefined;
  /*
   * A refusal, a silence or an undelivered command edges the control in the
   * warning colour over the state's own fill, so "on, and your press was
   * refused" reads as both.
   */
  const warned = isRefused || isLost || hasUnconfirmed || hasFailure;
  /* The game said it will refuse the press: dimmed with a dashed warning edge, apart from a reason the caller gave. */
  const gated = isBlocked && !isUnavailable;
  const edge = gated ? "blocked" : warned ? "warn" : undefined;
  const cannotPress = toggleView.unavailable !== null || isBlocked;
  const cannotPressReason =
    toggleView.unavailable ?? (isBlocked ? refusalText : null);
  return (
    <>
      <Tooltip text={toggleTip}>
        {glyph ? (
          <IconButton__Body
            type="button"
            aria-pressed={toggleView.on}
            aria-disabled={cannotPress || undefined}
            aria-label={ariaLabel}
            data-command-phase={phase}
            data-stream={isOffline ? "down" : undefined}
            data-command-edge={edge}
            data-predicted={isAdvised ? "at-risk" : undefined}
            onClick={() => press(false)}
            {...rest}
          >
            {toggleView.confirmation === "sent" ? (
              <SendIcon aria-hidden="true" />
            ) : (
              icon
            )}
          </IconButton__Body>
        ) : (
          <PlainButton
            type="button"
            size={size}
            tone={toggleView.on ? tone : undefined}
            pressed={toggleView.on}
            aria-pressed={toggleView.on}
            disabled={cannotPress || undefined}
            disabledReason={cannotPressReason ?? undefined}
            marked={marking}
            aria-label={ariaLabel}
            data-command-phase={phase}
            data-stream={isOffline ? "down" : undefined}
            data-command-edge={edge}
            data-predicted={isAdvised ? "at-risk" : undefined}
            onClick={() => press(false)}
            {...rest}
          >
            {/* An icon stands where the word would; SENT is still a word, since no icon says it. */}
            {icon !== undefined && toggleView.confirmation !== "sent" ? (
              icon
            ) : (
              <ReservedText
                shown={toggleView.word}
                reserve={toggleView.reserve}
              />
            )}
          </PlainButton>
        )}
      </Tooltip>
      {/* A held or modelled mark is spoken with the label, so only a press the mod has not answered is announced. */}
      <LiveRegion visuallyHidden>
        {markCarriesIt ? "" : (sentence ?? "")}
      </LiveRegion>
    </>
  );
}

/** The tone a command draws in: plain at rest, then the tone of the phase it is filled for. */
function commandTone(p: {
  restTone: CommandButtonTone;
  filled: boolean;
  isRefused: boolean;
  isFound: boolean;
  isArmed: boolean;
  confirmTone: CommandButtonTone;
  tone: CommandButtonTone;
}): CommandButtonTone {
  if (!p.filled) return p.restTone;
  if (p.isRefused) return "warn";
  // `found` reverses a warning, so it does not wear the warning's colour.
  if (p.isFound) return "neutral";
  if (p.isArmed) return p.confirmTone;
  return p.tone;
}

const armedPulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.65; }
`;

const CommandButton__Word = styled.span`
  display: block;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`;

const CommandButton__Face = styled.span`
  grid-area: 1 / 1;
  /* A face never grows past the button, so a word wider than the button is clipped inside it instead of spilling out. */
  min-width: 0;
  max-width: 100%;
  /* First in the cell's order, so the button's baseline is the face's and not an invisible sizer's. */
  order: -1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--gap-glyph);
`;

/* A command at rest is the quiet ghost; in effect, armed or refused it takes the one pressed fill. */
const CommandButton__Body = styled(Button__Body)<{
  $armed: boolean;
  $blocked: boolean;
  $fit: boolean;
}>`
  letter-spacing: 0.04em;

  /* Shrinks below its word so the word can be measured and give way to the icon. */
  ${({ $fit }) => ($fit ? "min-width: 0;" : "")}

  ${({ $armed }) =>
    $armed &&
    css`
      @media (prefers-reduced-motion: no-preference) {
        animation: ${armedPulse} 1s var(--ease-emphasis) infinite;
      }
    `}

  &:disabled {
    opacity: 0.5;
  }

  /* Dimmed toward the muted text token rather than faded, so the refusal reason stays readable; the warn border says the game refused. */
  ${({ $blocked }) =>
    $blocked &&
    css`
      background: transparent;
      border-style: dashed;
      border-color: var(--color-warn-mark);
      color: var(--color-text-muted);
      cursor: help;

      @media (hover: hover) {
        &:hover:not(:disabled) {
          border-color: var(--color-warn-mark);
          color: var(--color-warn-text);
        }
      }
    `}

  /* Both labels sit invisibly in the one grid cell with the face, so the box is as wide as the wider of them. */
  &[data-rest-label] {
    display: inline-grid;
    justify-items: center;
  }
  &[data-rest-label]::before,
  &[data-rest-label]::after {
    grid-area: 1 / 1;
    visibility: hidden;
    height: 0;
  }
  &[data-rest-label]::before {
    content: attr(data-rest-label);
  }
  &[data-rest-label]::after {
    content: attr(data-armed-label);
  }
`;

/* A glyph under a command: dimmed while the game says it will refuse, and pulsing while armed. */
const CommandGlyph__Body = styled(IconButton__Body)<{
  $armed: boolean;
  $blocked: boolean;
}>`
  ${({ $armed }) =>
    $armed &&
    css`
      @media (prefers-reduced-motion: no-preference) {
        animation: ${armedPulse} 1s var(--ease-emphasis) infinite;
      }
    `}
  ${({ $blocked }) =>
    $blocked &&
    css`
      opacity: 0.5;
      cursor: help;
    `}
`;
