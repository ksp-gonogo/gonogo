import { type ReactNode, useId, useRef, useState } from "react";
import styled, { css } from "styled-components";
import { GhostButton } from "./Button";
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
   * "popover" (default): the panel pops out, absolutely positioned over
   * whatever follows, sized to its own content, for a compact hint next to a
   * tight trigger (FleetRoster's per-row signal cell).
   * "inline": the panel expands IN FLOW below the trigger, full width,
   * pushing later content down rather than covering it, the accordion shape
   * a resource-row ledger needs. By default the trigger also grows a
   * rotating chevron so the control reads unambiguously as an expander (set
   * `chevron={false}` when `label` is itself a right-aligned, worded control
   * like "Show detail" and a second glyph would be redundant). Long panels
   * scroll inside a capped-height block instead of overflowing the row.
   */
  variant?: "popover" | "inline";
  /**
   * Whether the rotating chevron renders for `variant="inline"`. Defaults to
   * `true`. Set `false` when `label` already reads as the affordance (e.g.
   * "Show detail"): the trigger then right-aligns that label to where the
   * chevron would have sat, rather than showing both. Ignored for
   * `variant="popover"`, which never has a chevron.
   */
  chevron?: boolean;
  /**
   * Renders the trigger as a real `GhostButton` (bordered, padded chrome)
   * instead of the plain unstyled `Disclosure__Trigger`. Off by default, so
   * `FleetRoster`'s compact popover trigger (a coloured tag, not a worded
   * label) is unaffected. Pair with `chevron={false}` and a worded `label`
   * (e.g. "Show detail"): a chevron-less text label with no visible chrome
   * reads as plain text, which is exactly the "is this actually a button?"
   * complaint this prop exists to fix. The trigger sizes to its own content
   * and right-aligns within the row rather than stretching full width, so it
   * reads as a small control, not a giant clickable band.
   */
  asButton?: boolean;
  /**
   * Size of the `asButton` trigger. `"md"` (default) is the full bordered
   * `GhostButton` chrome (uppercase, tracked-out label) every other bordered
   * button in the kit uses. `"sm"` is a compact, quiet secondary control
   * (normal case, tight tracking, small type/padding, matching
   * `ActionButton`'s "ghost" tone) for rows where the trigger needs to read
   * as a small aside rather than a CTA-weight button. Ignored when
   * `asButton` is false.
   */
  buttonSize?: "md" | "sm";
}

/**
 * A minimal accessible disclosure: a real `<button aria-expanded>` that toggles a
 * panel, keyboard AND pointer reachable (click / Enter / Space to open, Escape to
 * close returning focus to the trigger), with a visible focus ring. The one
 * general-purpose focus/tap detail surface in the kit, deliberately NOT the
 * hover-only reveal `ControlDelayStream` uses (unreachable without a mouse). Use
 * it wherever a compact control needs to expand detail on demand: `popover`
 * (the default) for a tooltip-shaped hint, `inline` for a true accordion row.
 */
export function Disclosure({
  label,
  children,
  ariaLabel,
  className,
  variant = "popover",
  chevron = true,
  asButton = false,
  buttonSize = "md",
}: DisclosureProps) {
  const [open, setOpen] = useState(false);
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
        <Disclosure__Panel id={panelId} role="group" $variant={variant}>
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
  // Accepted for prop-type parity with Disclosure__ButtonTrigger (the two
  // are interchangeable as `TriggerTag` above); the plain trigger has no
  // bordered chrome to size, so this is unused here.
  $size: "md" | "sm";
}>`
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-4);
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  ${({ $variant, $align }) =>
    $variant === "inline" &&
    css`
      justify-content: ${$align === "end" ? "flex-end" : "space-between"};
      width: 100%;
      border-radius: var(--radius-sm);
      &:hover {
        background: var(--color-surface-sunken);
      }
    `}
  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;

/**
 * The `asButton` trigger: a real `GhostButton` (border, padding, hover/focus
 * chrome all inherited from it) rather than the bare `Disclosure__Trigger`
 * above. Sized to its own content and pinned to the row's trailing edge via
 * `align-self`, never stretched to `width: 100%` the way the plain trigger
 * is for `variant="inline"`, so it reads as a small control sitting at the
 * end of the row rather than a full-width clickable band with right-aligned
 * text inside it.
 *
 * `$size="sm"` overrides GhostButton's uppercase/tracked-out CTA styling
 * with the same compact, normal-case chrome `ActionButton`'s "ghost" tone
 * uses, for triggers that need to read as a quiet secondary control rather
 * than a primary-weight button. `min-height: 44px` is kept under a coarse
 * pointer regardless of size (matching `ToggleButton`'s own sm/md split) so
 * the smaller visual size never shrinks the touch target.
 */
const Disclosure__ButtonTrigger = styled(GhostButton)<{
  $variant: "popover" | "inline";
  $align: "between" | "end";
  $size: "md" | "sm";
}>`
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  ${({ $variant }) =>
    $variant === "inline" &&
    css`
      align-self: flex-end;
    `}
  ${({ $size }) =>
    $size === "sm" &&
    css`
      font-size: var(--font-size-2xs, 10px);
      font-weight: 600;
      letter-spacing: normal;
      text-transform: none;
      padding: var(--space-2, 2px) var(--space-8, 8px);
      border-radius: var(--radius-xs, 2px);

      @media (pointer: coarse) {
        min-height: 44px;
        padding: var(--space-6, 6px) var(--space-10, 10px);
      }
    `}
`;

const Disclosure__Chevron = styled.span<{ $open: boolean }>`
  display: inline-flex;
  flex-shrink: 0;
  @media (prefers-reduced-motion: no-preference) {
    transition: transform var(--duration-base, 150ms) var(--ease-standard, ease);
  }
  transform: rotate(${({ $open }) => ($open ? 90 : 0)}deg);
`;

const Disclosure__Panel = styled.div<{ $variant: "popover" | "inline" }>`
  ${({ $variant }) =>
    $variant === "popover"
      ? css`
          position: absolute;
          top: 100%;
          right: 0;
          /* Local sibling ordering inside this component's own stacking context:
             lift the popped panel above following content (e.g. later rows). Not
             app-global chrome, so a named z rung would wrongly outrank the
             dashboard's. */
          z-index: 1;
          margin-top: var(--space-2);
        `
      : css`
          position: static;
          width: 100%;
          /* border-box, because width: 100% + padding + border otherwise
             overflows the host row by the padding + border on each side:
             exactly the "ledger spills past its Card" defect operators hit
             at every width. Scoped here rather than a global reset so no
             other primitive's baseline moves. */
          box-sizing: border-box;
          margin-top: var(--space-2);
          /* An accordion body must never overlay or overflow the row below it:
             it grows in flow up to a cap, then scrolls its own content rather
             than spilling past the row's edge. */
          max-height: 16rem;
          overflow-y: auto;
        `}
  padding: var(--space-6) var(--space-8);
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
`;
