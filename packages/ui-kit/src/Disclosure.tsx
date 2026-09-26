import { type ReactNode, useId, useRef, useState } from "react";
import styled, { css } from "styled-components";
import { GhostButton } from "./Button";
import { focusRing } from "./focusRing";
import { ChevronRightIcon } from "./Icons";

export interface DisclosureProps {
  /**
   * The always-visible trigger content (text, a glyph, a badge). Pass a
   * function of `open` when the label itself should read differently once
   * expanded (e.g. "Show detail" → "Hide detail").
   */
  label: ReactNode | ((open: boolean) => ReactNode);
  /** The panel content, revealed when open. */
  children: ReactNode;
  /**
   * Accessible name for the trigger. Required when `label` is a non-text node
   * (an icon/glyph) so the button is not unlabelled to a screen reader.
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
   * `true`. Set `false` when `label` already reads as the affordance (e.g.
   * "Show detail"); the label then right-aligns where the chevron would sit.
   */
  chevron?: boolean;
  /**
   * Renders the trigger as a real `GhostButton` (bordered, padded chrome)
   * instead of a plain unstyled one, sized to its content and right-aligned.
   * Pair with `chevron={false}` and a worded `label`: a chevron-less label with
   * no chrome reads as plain text.
   */
  asButton?: boolean;
  /**
   * Size of the `asButton` trigger. `"md"` (default) is the full `GhostButton`
   * chrome; `"sm"` is a compact, quiet secondary control, as `ActionButton`'s
   * "ghost" tone.
   */
  buttonSize?: "md" | "sm";
  /**
   * Whether the panel starts expanded. Defaults to `false`, the disclosure's
   * ordinary shape: detail on demand.
   *
   * Pass `true` where the panel is the primary content and the trigger exists
   * so it can be folded away in a short tile. Read once, at mount; to re-seat
   * it, give the Disclosure a React key that changes with the condition.
   */
  defaultOpen?: boolean;
}

/**
 * A minimal accessible disclosure: a real `<button aria-expanded>` that toggles
 * a panel, reachable by keyboard and pointer (Enter / Space to open, Escape to
 * close and return focus). The kit's general-purpose detail-on-demand surface,
 * for when a hover-only reveal would be unreachable without a mouse.
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
  const showChevron = variant === "inline" && chevron;
  const resolvedLabel = typeof label === "function" ? label(open) : label;
  const TriggerTag = asButton ? Disclosure__ButtonTrigger : Disclosure__Trigger;

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
      <TriggerTag
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        $variant={variant}
        $align={variant === "inline" && !chevron ? "end" : "between"}
        $size={buttonSize}
      >
        {resolvedLabel}
        {showChevron && (
          <Disclosure__Chevron $open={open}>
            <ChevronRightIcon size={14} />
          </Disclosure__Chevron>
        )}
      </TriggerTag>
      {open && (
        <Disclosure__Panel
          id={panelId}
          role="group"
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
  // Unused: accepted so the two triggers are interchangeable as `TriggerTag`.
  $size: "md" | "sm";
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

/**
 * The `asButton` trigger: a real `GhostButton`, sized to its content and
 * pinned to the row's trailing edge. Under a coarse pointer it keeps a 44px
 * touch target whatever its size.
 */
const Disclosure__ButtonTrigger = styled(GhostButton)<{
  $variant: "popover" | "inline";
  $align: "between" | "end";
  $size: "md" | "sm";
}>`
  display: inline-flex;
  align-items: center;
  gap: var(--gap-glyph);
  ${({ $variant }) =>
    $variant === "inline" &&
    css`
      align-self: flex-end;
    `}
  ${({ $size }) =>
    $size === "sm" &&
    css`
      font-size: var(--font-size-compact);
      font-weight: 600;
      padding: var(--inset-control-small);
      border-radius: var(--radius-regular);

      @media (pointer: coarse) {
        min-height: 44px;
        padding: var(--inset-control-small-touch);
      }
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
        `
      : ""}
  padding: var(--inset-surface);
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-regular);
`;
