import {
  type ComponentPropsWithoutRef,
  forwardRef,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import styled from "styled-components";

/**
 * Props for {@link FitLabelButton}. Any other `button` attribute passes
 * through; `children` is replaced by `label` and `icon`.
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
}

/**
 * A `button` that shows its label while the label fits and its icon when it
 * does not. The switch is measured against the button's own width, not a
 * breakpoint, and follows resizes. It is an unstyled native button
 * (`type="button"` by default), so style it or wrap it as the layout needs.
 *
 * The accessible name is always `label`, carried in `aria-label` in both
 * states. Put anything explaining a disabled state in `title`, since it is the
 * only explanation left once the word is gone.
 *
 * @example
 * ```tsx
 * <FitLabelButton label="Settings" icon={<SettingsIcon />} onClick={onOpen} />
 * ```
 *
 * @category Button
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

const FitLabelButton__Label = styled.span`
  /* nowrap, so a label that does not fit overflows and the measurement stays honest. */
  white-space: nowrap;
`;

const FitLabelButton__Icon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
`;
