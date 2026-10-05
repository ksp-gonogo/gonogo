import type { Tone } from "@ksp-gonogo/sitrep-sdk";
import { LiveRegion, StatusIndicator } from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import styled from "styled-components";
import type { CheckState, SetupCheck } from "../checks";
import type { CopyRun } from "../copy";
import { SETUP_LINKS } from "../setupGuide";

const TONE: Record<CheckState, Tone> = {
  checking: "neutral",
  pass: "go",
  attention: "warn",
  fail: "nogo",
};

/** One check's state and sentence, as a toned row. */
export function CheckReading({ check }: Readonly<{ check: SetupCheck }>) {
  return (
    <StatusIndicator
      tone={TONE[check.state]}
      pulse={check.state === "checking" ? "fast" : undefined}
      data-check-state={check.state}
    >
      {check.text}
    </StatusIndicator>
  );
}

/**
 * A step's own automatic check. The region stays mounted for as long as the
 * step is on screen and only its words change, so a check that settles while
 * the operator is in another window is announced when it does.
 */
export function StepCheck({ check }: Readonly<{ check: SetupCheck }>) {
  return (
    <LiveRegion as="div">
      <CheckReading check={check} />
    </LiveRegion>
  );
}

/** A sentence from the copy table, each linked run drawn as a {@link DocLink}. */
export function Prose({ runs }: Readonly<{ runs: readonly CopyRun[] }>) {
  return (
    <>
      {runs.map((run) => {
        const href = run.link && Reflect.get(SETUP_LINKS, run.link);
        if (typeof href !== "string") return run.text;
        return (
          <DocLink key={`${run.link}:${run.text}`} href={href}>
            {run.text}
          </DocLink>
        );
      })}
    </>
  );
}

/** A link out of the wizard to a page that goes deeper, opened beside it so the setup is not lost. */
export function DocLink({
  href,
  children,
}: Readonly<{ href: string; children: ReactNode }>) {
  return (
    <DocLink__Anchor href={href} target="_blank" rel="noreferrer">
      {children}
    </DocLink__Anchor>
  );
}

const DocLink__Anchor = styled.a`
  color: var(--color-accent-fg);

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

/** What to try when a check fails, set apart from the instruction above it. */
export const Hint = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  padding-left: var(--indent-settings);
  border-left: 2px solid var(--color-border-strong);
  font-size: var(--font-size-compact);
  line-height: var(--line-height-prose);
  color: var(--color-text-muted);
`;

export const HintList = styled.ul`
  margin: 0;
  padding-left: 1.2em;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;
