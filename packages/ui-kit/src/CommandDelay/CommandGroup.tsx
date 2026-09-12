import { type ReactNode, useEffect } from "react";
import styled, { css } from "styled-components";

interface CommandGroupOwnProps<V extends Record<string, unknown>> {
  value: V;
  onChange: (v: V) => void;
  /** Fired exactly once, with the group's current `value`, on an explicit commit; never on a child input's own change. */
  onCommit: (v: V) => void;
  /** `no-path`: disables the commit control and switches it to an error tone. `onCommit` never fires while gated. */
  gated?: boolean;
  /** The group's own inputs (wheels/sliders/etc.): this component owns none of their rendering. */
  children: ReactNode;
  /**
   * What the commit button draws. A string is the ordinary case and names the
   * button by itself; a node is for an icon-only commit on a strip with no room
   * for a word, and it MUST be paired with `commitAriaLabel`, because every
   * icon in this kit is `aria-hidden` and a glyph alone leaves the button with
   * no accessible name at all. The pairing is a compile error to omit, see
   * `CommandGroupProps`. Defaults to "Commit".
   *
   * <p>A node also squares the button's inset, as `ComposerBar` does under
   * `sendVariant="icon"`: the horizontal padding is a word's, and left on it a
   * glyph commit is a word-shaped gap rather than the ~24px the strip that
   * asked for it was trying to buy.</p>
   */
  commitLabel?: ReactNode;
  /**
   * The commit button's accessible name, for when `commitLabel` cannot be one.
   * Always the ACTION and never the glyph ("Commit framing", not "Return
   * arrow"), and it is the name whichever way the button is drawn, so moving a
   * caller to the glyph never changes what a screen reader hears or what a
   * query for the control matches.
   */
  commitAriaLabel?: string;
  /** Reason shown (as the commit button's title) when gated, for a screen reader / hover explanation. */
  gatedReason?: string;
  /**
   * Where the commit control sits relative to the inputs. `"column"` (default)
   * keeps it on its own line under them; `"row"` puts it beside them, which is
   * the ~30px of height a corner-sized control strip cannot spare. Named as
   * `CommandDelay`'s own orientation prop is, in the same folder.
   */
  orientation?: "column" | "row";
  /**
   * Let the inputs break onto further lines. On by default, unlike the kit's
   * other rows, because that is what this group has always done and turning it
   * off under existing call sites would reflow them.
   *
   * <p>Turn it off for a strip that must stay one line. Without it, a caller
   * needing a single row has to defeat the wrap from outside with an inner
   * `width: max-content` track, which is a sideways-scrolling strip rather than
   * a row of controls.</p>
   */
  wrap?: boolean;
}

/**
 * The commit control's two props, with the a11y pairing spelled as a type: a
 * `commitLabel` that is not a string has to come with a `commitAriaLabel`.
 *
 * <p>It is a compile error rather than a runtime warning because the failure it
 * guards is invisible: a nameless button looks finished to the person who wrote
 * it, renders fine, and reaches a screen reader as "button". Every consumer of
 * this kit typechecks (the extraction probe makes sure of it), so a compile
 * error is the one form of this rule that cannot ship. The component ALSO warns
 * in dev, for the caller who spreads a props bag past the check.</p>
 */
type CommandGroupCommitNaming =
  | { commitLabel?: string; commitAriaLabel?: string }
  | { commitLabel: ReactNode; commitAriaLabel: string };

export type CommandGroupProps<V extends Record<string, unknown>> =
  CommandGroupOwnProps<V> & CommandGroupCommitNaming;

/**
 * Grouped-confirm / select-then-commit primitive: N child inputs write into
 * a shared, controlled `value` via `onChange` as the operator dials them,
 * and nothing dispatches until the explicit commit action fires `onCommit`
 * once with the whole group's value: one delayed dispatch for the whole
 * group, not one per input. Vanilla-safe: no data hooks, no dispatch of its
 * own: the commit callback is the caller's own `useCommand().send`.
 */
export function CommandGroup<V extends Record<string, unknown>>({
  value,
  onCommit,
  gated = false,
  children,
  commitLabel = "Commit",
  commitAriaLabel,
  gatedReason = "No path: command dispatch is disabled",
  orientation = "column",
  wrap = true,
}: CommandGroupProps<V>) {
  /*
   * A glyph commit with no name reaches a screen reader as "button" and looks
   * finished to everyone else, so say so out loud. The types already refuse it;
   * this is for the caller who assembled the props elsewhere and spread them,
   * where there was no literal for the checker to look at.
   */
  const named =
    typeof commitLabel === "string" || typeof commitLabel === "number";
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (named || commitAriaLabel) return;
    console.warn(
      "CommandGroup was given a non-text commitLabel and no commitAriaLabel, " +
        "so its commit button has no accessible name. Pass commitAriaLabel " +
        "naming the action (not the glyph).",
    );
  }, [named, commitAriaLabel]);

  return (
    <CommandGroup__Root data-gated={gated} $orientation={orientation}>
      <CommandGroup__Inputs $wrap={wrap}>{children}</CommandGroup__Inputs>
      <CommandGroup__CommitButton
        type="button"
        disabled={gated}
        $gated={gated}
        $orientation={orientation}
        $icon={!named}
        aria-label={commitAriaLabel}
        title={gated ? gatedReason : undefined}
        onClick={() => {
          if (gated) return;
          onCommit(value);
        }}
      >
        {commitLabel}
      </CommandGroup__CommitButton>
    </CommandGroup__Root>
  );
}

const CommandGroup__Root = styled.div<{ $orientation: "column" | "row" }>`
  display: flex;
  flex-direction: ${({ $orientation }) => $orientation};
  ${({ $orientation }) => $orientation === "row" && "align-items: center;"}
  gap: var(--space-8, 8px);
`;

const CommandGroup__Inputs = styled.div<{ $wrap: boolean }>`
  display: flex;
  flex-wrap: ${({ $wrap }) => ($wrap ? "wrap" : "nowrap")};
  gap: var(--space-8, 8px);
  align-items: center;
`;

const CommandGroup__CommitButton = styled.button<{
  $gated: boolean;
  $orientation: "column" | "row";
  $icon: boolean;
}>`
  align-self: ${({ $orientation }) =>
    $orientation === "row" ? "center" : "flex-start"};
  /* Beside the inputs the button is the thing a narrow strip would squeeze
     first, and a commit control squeezed to nothing is one nobody can press. */
  ${({ $orientation }) => $orientation === "row" && "flex-shrink: 0;"}
  padding: var(--space-4, 4px) var(--space-12, 12px);
  font-size: var(--font-size-xs);
  font-weight: 600;
  border-radius: var(--radius-sm, 3px);
  border: 1px solid var(--color-border-subtle);
  background: var(--color-surface-raised);
  color: var(--color-text-primary);
  cursor: pointer;

  ${({ $icon }) =>
    $icon &&
    css`
      /* The glyph is centred in the box rather than sitting on the text
         baseline it no longer has, and the inset is squared off the vertical
         one so the button is a square and not a word-shaped gap. Same treatment
         as ComposerBar's send under sendVariant="icon". */
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: var(--space-4, 4px);

      @media (pointer: coarse) {
        padding: var(--space-6, 6px);
      }
    `}

  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  ${({ $gated }) =>
    $gated &&
    css`
      cursor: not-allowed;
      border-color: var(--color-status-nogo-bg);
      background: var(--color-status-nogo-bg);
      color: var(--color-status-nogo-on-bg);
      opacity: 0.7;
    `}
`;
