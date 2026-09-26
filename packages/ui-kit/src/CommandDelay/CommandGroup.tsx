import { type ReactNode, useEffect, useId } from "react";
import styled, { css } from "styled-components";
import { focusRing } from "../focusRing";
import { VisuallyHidden } from "../VisuallyHidden";

interface CommandGroupOwnProps<V extends Record<string, unknown>> {
  value: V;
  /** Fired exactly once, with the group's current `value`, on an explicit commit; never on a child input's own change. */
  onCommit: (v: V) => void;
  /** `no-path`: marks the commit control unavailable and switches it to an error tone. It stays focusable and says why; `onCommit` never fires while gated. */
  gated?: boolean;
  /** The group's own inputs (wheels/sliders/etc.): this component owns none of their rendering. */
  children: ReactNode;
  /**
   * What the commit button draws. Defaults to "Commit". A string names the
   * button by itself; a node (an icon-only commit) MUST be paired with
   * `commitAriaLabel`, because every kit icon is `aria-hidden`, and omitting it
   * is a compile error. A node also squares the button's inset.
   */
  commitLabel?: ReactNode;
  /**
   * The commit button's accessible name, for when `commitLabel` cannot be one.
   * Always the ACTION, never the glyph ("Commit framing", not "Return arrow").
   */
  commitAriaLabel?: string;
  /** Why a gated commit is unavailable: the button's description, and its hover title. */
  gatedReason?: string;
  /**
   * Where the commit control sits relative to the inputs. `"column"` (default)
   * puts it on its own line under them; `"row"` puts it beside them, for a
   * corner-sized strip that cannot spare the height.
   */
  orientation?: "column" | "row";
  /**
   * Let the inputs break onto further lines. On by default, unlike the kit's
   * other rows. Turn it off for a strip that must stay one line.
   */
  wrap?: boolean;
}

/**
 * The commit control's two props, with the a11y pairing spelled as a type: a
 * `commitLabel` that is not a string has to come with a `commitAriaLabel`. The
 * component also warns in dev, for a caller who spreads a props bag past the
 * check.
 */
type CommandGroupCommitNaming =
  | { commitLabel?: string; commitAriaLabel?: string }
  | { commitLabel: ReactNode; commitAriaLabel: string };

export type CommandGroupProps<V extends Record<string, unknown>> =
  CommandGroupOwnProps<V> & CommandGroupCommitNaming;

/**
 * Grouped-confirm (select-then-commit) primitive: child inputs write into the
 * caller's controlled `value`, and nothing dispatches until the explicit commit
 * fires `onCommit` once with the whole group's value. One delayed dispatch for
 * the group, not one per input. It has no data hooks and no dispatch of its
 * own.
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
  // The types refuse a nameless glyph commit; this catches a spread props bag the checker could not see.
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
  const reasonId = useId();

  return (
    <CommandGroup__Root data-gated={gated} $orientation={orientation}>
      <CommandGroup__Inputs $wrap={wrap}>{children}</CommandGroup__Inputs>
      {gated && <VisuallyHidden id={reasonId}>{gatedReason}</VisuallyHidden>}
      <CommandGroup__CommitButton
        type="button"
        aria-disabled={gated || undefined}
        aria-describedby={gated ? reasonId : undefined}
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
  gap: var(--gap-control-row);
`;

const CommandGroup__Inputs = styled.div<{ $wrap: boolean }>`
  display: flex;
  flex-wrap: ${({ $wrap }) => ($wrap ? "wrap" : "nowrap")};
  gap: var(--gap-control-row);
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
  padding: var(--inset-commit-button);
  font-size: var(--font-size-compact);
  font-weight: 600;
  border-radius: var(--radius-regular);
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
      padding: var(--inset-icon-button-compact);

      @media (pointer: coarse) {
        padding: var(--inset-icon-button);
      }
    `}

  ${focusRing}

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
