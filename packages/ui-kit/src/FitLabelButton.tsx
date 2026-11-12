import type { AnyBoundCommand } from "@ksp-gonogo/sitrep-sdk";
import {
  type ComponentPropsWithoutRef,
  forwardRef,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import styled from "styled-components";
import { useBoundCommandInput } from "./CommandButton/commandInput";
import { commandOutlineEdge } from "./commandEdge";
import { LiveRegion } from "./LiveRegion";
import { Tooltip } from "./Tooltip";

/**
 * Props for {@link FitLabelButton}. Any other `button` attribute passes
 * through; `children` is replaced by `label` and `icon`.
 * Useful for giving a control in a panel the operator can narrow a label and
 * an icon to fall back on. Used by {@link FitLabelButton}.
 *
 * @category Button
 */
export interface FitLabelButtonProps
  extends Omit<ComponentPropsWithoutRef<"button">, "children"> {
  /**
   * The button's word and its accessible name, in both states.
   */
  label: string;
  /** Shown in place of the label when the label does not fit. */
  icon: ReactNode;
  /**
   * The command pressing the button sends, made with `with` on a `useCommand`
   * handle. While the label is shown, a word over it says what became of the
   * press: "SENT" while it is unanswered, then "Refused", "No reply" or
   * "Found". While the icon is shown the word is left out, and the button's
   * edge, its tip and a live region carry the outcome.
   */
  command?: AnyBoundCommand;
  /** Why a command button cannot be pressed now. It is drawn dimmed with this as its tip and a press sends nothing. */
  unavailable?: string;
}

/**
 * A `button` that shows its label while the label fits and its icon when it
 * does not. Useful for a control in a panel the operator can narrow. The switch
 * is measured against the button's own width and follows resizes. It is an
 * unstyled native button (`type="button"` by default), so it has no border,
 * fill or padding until you give it some: style it with
 * `styled(FitLabelButton)` or wrap it as the layout needs.
 *
 * Given a `command`, a press sends it and a word over the label says what became
 * of the press.
 *
 * The accessible name is always `label`, carried in `aria-label` in both
 * states. Put anything explaining a disabled state in `title`, since it is the
 * only explanation left once the word is gone.
 *
 * @example
 * ```tsx
 * import { FitLabelButton, SettingsIcon } from "@ksp-gonogo/ui-kit";
 *
 * function SettingsButton(props: { onOpen: () => void }) {
 *   return <FitLabelButton label="Settings" icon={<SettingsIcon />} onClick={props.onOpen} />;
 * }
 * ```
 *
 * @category Button
 */
export const FitLabelButton = forwardRef<
  HTMLButtonElement,
  FitLabelButtonProps
>(function FitLabelButton(props, ref) {
  if (props.command) {
    return (
      <CommandedFitLabelButton {...props} command={props.command} ref={ref} />
    );
  }
  const { command: _command, unavailable: _unavailable, ...rest } = props;
  return <PlainFitLabelButton {...rest} ref={ref} />;
});

const CommandedFitLabelButton = forwardRef<
  HTMLButtonElement,
  FitLabelButtonProps & { command: AnyBoundCommand }
>(function CommandedFitLabelButton(
  { command, unavailable, onClick, ...rest },
  ref,
) {
  const input = useBoundCommandInput({ command, unavailable });
  return (
    <>
      <Tooltip text={input.tip}>
        <PlainFitLabelButton
          {...rest}
          {...input.edge}
          ref={ref}
          word={input.word}
          onClick={(e) => {
            if (input.inert) return;
            input.send();
            onClick?.(e);
          }}
        />
      </Tooltip>
      <LiveRegion visuallyHidden>{input.announce}</LiveRegion>
    </>
  );
});

const PlainFitLabelButton = forwardRef<
  HTMLButtonElement,
  Omit<FitLabelButtonProps, "command" | "unavailable"> & {
    word?: string | null;
  }
>(function PlainFitLabelButton({ label, icon, type, word, ...rest }, ref) {
  return (
    <FitLabelButton__Root
      ref={ref}
      type={type ?? "button"}
      aria-label={label}
      {...rest}
    >
      <FitLabel label={label} icon={icon} word={word} />
    </FitLabelButton__Root>
  );
});

const FitLabelButton__Root = styled.button`
  ${commandOutlineEdge}
`;

/**
 * The label-or-icon content of a {@link FitLabelButton}, for another control
 * that draws its own button and wants the same collapse. Used by
 * {@link FitLabelButton} and {@link Button}. It measures its parent's
 * content box, so the parent must be able to shrink below the label
 * (`min-width: 0`). Both states are `aria-hidden`: the parent carries the name.
 * Kit-internal, not on the barrel.
 */
export function FitLabel({
  label,
  icon,
  word,
}: {
  label: string;
  icon: ReactNode;
  word?: string | null;
}) {
  const contentRef = useRef<HTMLSpanElement | null>(null);
  const ghostRef = useRef<HTMLSpanElement | null>(null);
  const [fits, setFits] = useState(true);

  useLayoutEffect(() => {
    const content = contentRef.current;
    const ghost = ghostRef.current;
    if (!content || !ghost) return;
    const measure = () => {
      // The content span's clientWidth is the button's content box, padding excluded.
      setFits(ghost.scrollWidth <= content.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    observer.observe(ghost);
    return () => observer.disconnect();
  }, []);

  return (
    <FitLabelButton__Content ref={contentRef}>
      <FitLabelButton__Ghost ref={ghostRef} aria-hidden="true">
        {label}
      </FitLabelButton__Ghost>
      {fits ? (
        <FitLabelButton__Label aria-hidden="true" $hidden={!!word}>
          {label}
        </FitLabelButton__Label>
      ) : (
        <FitLabelButton__Icon aria-hidden="true" data-fit-label-icon="">
          {icon}
        </FitLabelButton__Icon>
      )}
      {fits && word ? (
        <FitLabelButton__Word aria-hidden="true">{word}</FitLabelButton__Word>
      ) : null}
    </FitLabelButton__Content>
  );
}

const FitLabelButton__Content = styled.span`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Shrinks to what the parent allows, so an overlong label is detected rather than overflowing its cell. */
  min-width: 0;
  width: 100%;
`;

/** Measured, never seen, never read out. */
const FitLabelButton__Ghost = styled.span`
  position: absolute;
  left: 0;
  top: 0;
  visibility: hidden;
  pointer-events: none;
  white-space: nowrap;
`;

const FitLabelButton__Label = styled.span<{ $hidden?: boolean }>`
  /* nowrap, so a label that does not fit overflows and the measurement stays honest. */
  white-space: nowrap;
  ${({ $hidden }) => ($hidden ? "visibility: hidden;" : "")}
`;

/* Over the label, which keeps its place hidden, so the button is the same size in every phase. */
const FitLabelButton__Word = styled.span`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  pointer-events: none;
  font-size: var(--font-size-caption);
  letter-spacing: 0.08em;
`;

const FitLabelButton__Icon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
`;
