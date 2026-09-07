import type { ReactNode } from "react";
import styled, { css } from "styled-components";

export interface CommandGroupProps<V extends Record<string, unknown>> {
  value: V;
  onChange: (v: V) => void;
  /** Fired exactly once, with the group's current `value`, on an explicit commit; never on a child input's own change. */
  onCommit: (v: V) => void;
  /** `no-path`: disables the commit control and switches it to an error tone. `onCommit` never fires while gated. */
  gated?: boolean;
  /** The group's own inputs (wheels/sliders/etc.): this component owns none of their rendering. */
  children: ReactNode;
  /** Label for the commit button. Defaults to "Commit". */
  commitLabel?: string;
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
  gatedReason = "No path: command dispatch is disabled",
  orientation = "column",
  wrap = true,
}: CommandGroupProps<V>) {
  return (
    <CommandGroup__Root data-gated={gated} $orientation={orientation}>
      <CommandGroup__Inputs $wrap={wrap}>{children}</CommandGroup__Inputs>
      <CommandGroup__CommitButton
        type="button"
        disabled={gated}
        $gated={gated}
        $orientation={orientation}
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
