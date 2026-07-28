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
}: CommandGroupProps<V>) {
  return (
    <CommandGroup__Root data-gated={gated}>
      <CommandGroup__Inputs>{children}</CommandGroup__Inputs>
      <CommandGroup__CommitButton
        type="button"
        disabled={gated}
        $gated={gated}
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

const CommandGroup__Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const CommandGroup__Inputs = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
`;

const CommandGroup__CommitButton = styled.button<{ $gated: boolean }>`
  align-self: flex-start;
  padding: 4px 12px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  border-radius: 3px;
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
      color: var(--color-status-nogo-fg);
      opacity: 0.7;
    `}
`;
