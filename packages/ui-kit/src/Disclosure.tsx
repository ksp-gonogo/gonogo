import { type ReactNode, useId, useRef, useState } from "react";
import styled, { css } from "styled-components";
import { Button, type ButtonSize } from "./Button";
import { focusRing, focusRingInset } from "./focusRing";
import { ChevronRightIcon } from "./Icons";
import { useKeyboardScrollable } from "./useScrollerMetric";

/**
 * Props for {@link Disclosure}.
 *
 * @category Disclosure
 */
export interface DisclosureProps {
  /**
   * The always-visible trigger content (text, a glyph, a badge). Pass a
   * function of `open` when the label itself should read differently once
   * expanded ("Show detail" to "Hide detail", for example).
   */
  label: ReactNode | ((open: boolean) => ReactNode);
  /** The panel content, revealed when open. */
  children: ReactNode;
  /**
   * Accessible name for the trigger. Required when `label` is a non-text node
   * (an icon or glyph) so the button is not unlabelled to a screen reader.
   */
  ariaLabel?: string;
  className?: string;
  /**
   * - `"popover"` (default): the panel pops out over whatever follows, sized to
   *   its content, for a compact hint beside a tight trigger
   * - `"inline"`: the panel expands in flow below the trigger, full width, as
   *   an accordion. The trigger grows a rotating chevron unless `chevron={false}`
   */
  variant?: "popover" | "inline";
  /**
   * How tall an `inline` panel may grow. `"cap"` (default) stops at a fixed
   * height and scrolls. `"auto"` grows in flow, for a panel already inside a
   * scrolling body, where a second scroller would hide content.
   */
  panelHeight?: "cap" | "auto";
  /**
   * Whether the rotating chevron renders for `variant="inline"`. Defaults to
   * `true`. Set `false` when `label` already reads as the affordance, such as
   * "Show detail"; the label then right-aligns where the chevron would sit.
   */
  chevron?: boolean;
  /**
   * Renders the trigger as the kit's ghost `Button` (bordered, padded chrome)
   * instead of a plain unstyled one, sized to its content and right-aligned.
   * Pair with `chevron={false}` and a worded `label`: a chevron-less label with
   * no chrome reads as plain text.
   */
  asButton?: boolean;
  /**
   * Size of the `asButton` trigger, the `Button` size of the same name.
   */
  buttonSize?: ButtonSize;
  /**
   * Whether the panel starts expanded. Defaults to `false`.
   *
   * Pass `true` where the panel is the primary content and the trigger lets it
   * be folded away in a short tile. It is read once, at mount; to reset it,
   * give the Disclosure a React key that changes with the condition.
   */
  defaultOpen?: boolean;
}

/**
 * A button that shows and hides a panel of detail. The trigger is a real
 * `<button aria-expanded>`, so Enter and Space toggle it, and Escape closes
 * the panel and returns focus to the trigger. Use it for detail on demand
 * wherever a hover-only reveal would be unreachable without a mouse. By
 * default the panel pops over what follows; `variant="inline"` expands it in
 * flow as an accordion.
 *
 * @example
 * ```tsx
 * <Disclosure
 *   variant="inline"
 *   chevron={false}
 *   label={(open) => (open ? "Hide detail" : "Show detail")}
 * >
 *   <StageBreakdown stages={stages} />
 * </Disclosure>
 * ```
 *
 * @category Disclosure
 */
export function Disclosure({
  label,
  children,
  ariaLabel,
  className,
  variant = "popover",
  panelHeight = "cap",
  chevron = true,
  asButton = false,
  buttonSize = "md",
  defaultOpen = false,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const panelTabIndex = useKeyboardScrollable(panel);
  const showChevron = variant === "inline" && chevron;
  const resolvedLabel = typeof label === "function" ? label(open) : label;
  const triggerProps = {
    ref: triggerRef,
    type: "button" as const,
    "aria-expanded": open,
    "aria-controls": panelId,
    "aria-label": ariaLabel,
    onClick: () => setOpen((v) => !v),
  };
  const triggerBody = (
    <>
      {resolvedLabel}
      {showChevron && (
        <Disclosure__Chevron $open={open}>
          <ChevronRightIcon size={14} />
        </Disclosure__Chevron>
      )}
    </>
  );

  return (
    <Disclosure__Root
      className={className}
      $variant={variant}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      {asButton ? (
        <Disclosure__ButtonTrigger
          {...triggerProps}
          variant="ghost"
          size={buttonSize}
          $inline={variant === "inline"}
        >
          {triggerBody}
        </Disclosure__ButtonTrigger>
      ) : (
        <Disclosure__Trigger
          {...triggerProps}
          $variant={variant}
          $align={variant === "inline" && !chevron ? "end" : "between"}
        >
          {triggerBody}
        </Disclosure__Trigger>
      )}
      {open && (
        <Disclosure__Panel
          ref={setPanel}
          id={panelId}
          role="group"
          tabIndex={panelTabIndex}
          $variant={variant}
          $panelHeight={panelHeight}
        >
          {children}
        </Disclosure__Panel>
      )}
    </Disclosure__Root>
  );
}

const Disclosure__Root = styled.div<{ $variant: "popover" | "inline" }>`
  position: relative;
  display: ${({ $variant }) => ($variant === "inline" ? "flex" : "inline-flex")};
  flex-direction: column;
  width: ${({ $variant }) => ($variant === "inline" ? "100%" : "auto")};
`;

const Disclosure__Trigger = styled.button<{
  $variant: "popover" | "inline";
  $align: "between" | "end";
}>`
  display: inline-flex;
  align-items: center;
  gap: var(--gap-glyph);
  padding: var(--inset-glyph-button);
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  ${({ $variant, $align }) =>
    $variant === "inline" &&
    css`
      justify-content: ${$align === "end" ? "flex-end" : "space-between"};
      width: 100%;
      border-radius: var(--radius-regular);
      &:hover {
        background: var(--color-surface-sunken);
      }
    `}
  ${focusRing}
`;

/** The `asButton` trigger: the kit's ghost `Button`, pinned to the row's trailing edge when inline. */
const Disclosure__ButtonTrigger = styled(Button)<{ $inline: boolean }>`
  ${({ $inline }) =>
    $inline &&
    css`
      align-self: flex-end;
    `}
`;

const Disclosure__Chevron = styled.span<{ $open: boolean }>`
  display: inline-flex;
  flex-shrink: 0;
  @media (prefers-reduced-motion: no-preference) {
    transition: transform var(--duration-base) var(--ease-standard);
  }
  transform: rotate(${({ $open }) => ($open ? 90 : 0)}deg);
`;

const Disclosure__Panel = styled.div<{
  $variant: "popover" | "inline";
  $panelHeight: "cap" | "auto";
}>`
  ${({ $variant }) =>
    $variant === "popover"
      ? css`
          position: absolute;
          top: 100%;
          right: 0;
          /* Local sibling ordering: lifts the popped panel above following rows, off the app z ladder. */
          z-index: 1;
          margin-top: var(--gap-disclosure);
        `
      : css`
          position: static;
          width: 100%;
          margin-top: var(--gap-disclosure);
        `}
  /* An accordion body grows in flow up to a cap, then scrolls, never spilling past the row below. */
  ${({ $variant, $panelHeight }) =>
    $variant === "inline" && $panelHeight === "cap"
      ? css`
          max-height: 16rem;
          overflow-y: auto;
          ${focusRingInset}
        `
      : ""}
  padding: var(--inset-surface);
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-regular);
`;
