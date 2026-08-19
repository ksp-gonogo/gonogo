import {
  type ComponentPropsWithoutRef,
  forwardRef,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import styled from "styled-components";

export interface FitLabelButtonProps
  extends Omit<ComponentPropsWithoutRef<"button">, "children"> {
  /**
   * The button's word AND its accessible name, in both states. Not optional and
   * not separate from the name on purpose: see the component doc.
   */
  label: string;
  /** Shown in place of the label when the label does not fit. */
  icon: ReactNode;
}

/**
 * A button that falls back to an icon when its label does not fit.
 *
 * The switch is MEASURED, not a breakpoint. A `cols < 6` style guess is wrong
 * the moment a label is longer than the one it was tuned against, and the same
 * lesson as the tiny-mode work applies: a rule that looks right in isolation is
 * not evidence about the real box. This compares the label's natural width
 * against the width the button actually has.
 *
 * The measurement uses a hidden GHOST copy of the label rather than the visible
 * one, because measuring the visible label would oscillate: collapsing removes
 * the text, the button then has room, so it expands, so it has no room. The
 * ghost's width does not depend on the state being decided from it.
 *
 * **The accessible name never changes.** `aria-label` carries it in both states
 * and the visible text is `aria-hidden`, so the two cannot drift: a screen
 * reader says the same word whether or not the word is on screen. A button did
 * not become a different control by getting narrower, and a user who cannot see
 * the icon must not be able to tell which mode it is in.
 *
 * Anything explaining a DISABLED state has to travel in `title`, which is
 * carried through untouched and is the only explanation left once the word is
 * gone.
 */
export const FitLabelButton = forwardRef<
  HTMLButtonElement,
  FitLabelButtonProps
>(function FitLabelButton({ label, icon, type, ...rest }, ref) {
  const contentRef = useRef<HTMLSpanElement | null>(null);
  const ghostRef = useRef<HTMLSpanElement | null>(null);
  const [fits, setFits] = useState(true);

  useLayoutEffect(() => {
    const content = contentRef.current;
    const ghost = ghostRef.current;
    if (!content || !ghost) return;
    const measure = () => {
      // clientWidth of the content span IS the button's content box, so the
      // padding is already excluded without reading computed styles.
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
    <button ref={ref} type={type ?? "button"} aria-label={label} {...rest}>
      <FitLabelButton__Content ref={contentRef}>
        <FitLabelButton__Ghost ref={ghostRef} aria-hidden="true">
          {label}
        </FitLabelButton__Ghost>
        {fits ? (
          <FitLabelButton__Label aria-hidden="true">
            {label}
          </FitLabelButton__Label>
        ) : (
          <FitLabelButton__Icon aria-hidden="true" data-fit-label-icon="">
            {icon}
          </FitLabelButton__Icon>
        )}
      </FitLabelButton__Content>
    </button>
  );
});

const FitLabelButton__Content = styled.span`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  /* min-width lets the button shrink to whatever its parent allows, which is
     the whole point: a button that refuses to shrink never reports a label that
     does not fit, it just overflows its cell. */
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

const FitLabelButton__Label = styled.span`
  /* nowrap, so a label that does not fit OVERFLOWS rather than wrapping. The
     defect this component exists for is a word breaking mid-syllable, and a
     wrapping label would also make the measurement lie: two short lines fit a
     width the word does not. */
  white-space: nowrap;
`;

const FitLabelButton__Icon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
`;
