import { Button, LiveRegion } from "@ksp-gonogo/ui-kit";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";

const COPIED_MS = 2000;

type CopyOutcome = "idle" | "copied" | "failed";

const ANNOUNCE: Partial<Record<CopyOutcome, (label: string) => string>> = {
  copied: (label) => `Copied ${label}`,
  failed: () => "Could not copy, select the text instead",
};

export interface CommandBlockProps {
  /** The text to run, printed exactly as it is copied. */
  command: string;
  /** What the command is, for the copy button's name: "run command" reads as "Copy run command". */
  label: string;
}

/**
 * A command the operator is meant to run somewhere else, with a button that
 * copies it. A long command stays on one line, as it is typed, and scrolls
 * sideways inside the box: the scroll region is focusable and named, so the
 * arrow keys reach the end of it, and the copy button stays where it is.
 */
export function CommandBlock({ command, label }: Readonly<CommandBlockProps>) {
  const [outcome, setOutcome] = useState<CopyOutcome>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    let next: CopyOutcome = "copied";
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      // No clipboard on an insecure origin other than localhost, or permission refused: the text is still on screen to select.
      next = "failed";
    }
    setOutcome(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOutcome("idle"), COPIED_MS);
  }

  return (
    <CommandBlock__Root>
      <CommandBlock__Scroll role="group" aria-label={label} tabIndex={0}>
        <CommandBlock__Text>{command}</CommandBlock__Text>
      </CommandBlock__Scroll>
      <Button
        variant="ghost"
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy ${label}`}
      >
        {outcome === "copied" ? "Copied" : "Copy"}
      </Button>
      <LiveRegion visuallyHidden>{ANNOUNCE[outcome]?.(label)}</LiveRegion>
    </CommandBlock__Root>
  );
}

const CommandBlock__Root = styled.div`
  display: flex;
  align-items: flex-start;
  gap: var(--gap-related);
  padding: var(--inset-surface);
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-regular);
`;

const CommandBlock__Scroll = styled.div`
  flex: 1;
  min-width: 0;
  overflow-x: auto;

  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;

const CommandBlock__Text = styled.code`
  display: block;
  width: max-content;
  font-family: var(--font-family-mono);
  font-size: var(--font-size-compact);
  line-height: var(--line-height-prose);
  color: var(--color-text-primary);
  white-space: pre;
  user-select: all;
`;
