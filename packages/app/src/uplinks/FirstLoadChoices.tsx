import {
  Button,
  ButtonGroup,
  Stack,
  Text,
  ToggleButton,
} from "@ksp-gonogo/ui-kit";
import { useEffect, useState } from "react";
import styled from "styled-components";
import type { ConsentInfo } from "./consent";
import { UplinkIdentityBlock } from "./UplinkIdentityBlock";

export interface FirstLoadAnswers {
  /** One answer per Uplink, in the order they were given: true to load. */
  uplinks: boolean[];
}

export interface FirstLoadChoicesProps {
  uplinks: readonly ConsentInfo[];
  /** Answers already given, for a page that opens part answered. */
  initial?: { uplinks?: readonly (boolean | undefined)[] };
  onDone: (answers: FirstLoadAnswers) => void;
}

/**
 * The name a row is titled with. A name the mod or the index vouches for is the
 * Uplink's; a name only the bundle claims stays in the identity block below,
 * and the title falls back to the id the mod reports, so a bundle cannot borrow
 * a name in the place an operator decides whether to run it. Either way the
 * title names the Uplink and never the mod it connects.
 */
export function uplinkTitle(info: ConsentInfo): string {
  const name =
    info.identity?.name.source === "bundle" ? info.id : info.name || info.id;
  return /uplink$/i.test(name) ? name : `${name} Uplink`;
}

function builtFor(info: ConsentInfo): string | undefined {
  const name = info.mod?.name;
  if (!name) return undefined;
  const version = info.mod?.builtAgainst;
  return version ? `Built for ${name} ${version}` : `Built for ${name}`;
}

/**
 * Every question a brand new browser has to answer before the dashboard opens,
 * on one page: one row per Uplink that asks for consent. Each row needs its own answer, so loading an Uplink stays a choice
 * made about that Uplink. Escape answers whatever is still open with Skip and
 * Decline, so every way out leaves an answer behind.
 *
 * On a station the Uplinks are not a question: every one the main screen runs
 * loads, so they are listed with no Skip or Load and Continue is the only
 * control.
 */
export function FirstLoadChoices({
  uplinks,
  initial,
  onDone,
}: Readonly<FirstLoadChoicesProps>) {
  const [answers, setAnswers] = useState<(boolean | undefined)[]>(() =>
    uplinks.map((_, n) => initial?.uplinks?.[n]),
  );

  const notice = uplinks.length > 0 && uplinks.every((info) => info.onStation);
  const open = notice
    ? 0
    : answers.filter((answer) => answer === undefined).length;
  const questions = !notice;

  // Escape answers what is still open and leaves what was chosen alone.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onDone({ uplinks: answers.map((value) => notice || value === true) });
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [answers, notice, onDone]);

  const answer = (n: number, granted: boolean) =>
    setAnswers((current) =>
      current.map((value, k) => (k === n ? granted : value)),
    );

  return (
    <Stack gap="section">
      {questions && (
        <Text level="muted" size="sm">
          Answer these once for this browser. Settings changes any of them
          later.
        </Text>
      )}

      {uplinks.length > 0 && (
        <Stack as="section" gap="related-comfortable">
          <SectionHeading>
            {notice
              ? "Uplinks from the main screen"
              : "Uplinks installed in KSP"}
          </SectionHeading>
          <Text level="muted" size="sm">
            {notice
              ? "This station loads every Uplink the main screen runs."
              : "An Uplink's code runs with the same access as this app, so load only the ones you trust. Skipping one leaves out all of it: its widgets and what it adds to other widgets."}
          </Text>
          <Rows>
            {uplinks.map((info, n) => {
              const title = uplinkTitle(info);
              const mod = builtFor(info);
              return (
                <ChoiceRow as="li" key={`${info.id}@${info.version}`}>
                  <Stack gap="caption">
                    <Text weight="semibold">
                      {title} <Meta>v{info.version}</Meta>
                    </Text>
                    {mod && (
                      <Text level="muted" size="sm">
                        {mod}
                      </Text>
                    )}
                    {info.identity && (
                      <UplinkIdentityBlock identity={info.identity} />
                    )}
                  </Stack>
                  {!notice && (
                    <ButtonGroup role="group" aria-label={`Load ${title}?`}>
                      <ToggleButton
                        size="sm"
                        tone="warn"
                        pressed={answers[n] === false}
                        onClick={() => answer(n, false)}
                      >
                        Skip
                      </ToggleButton>
                      <ToggleButton
                        size="sm"
                        pressed={answers[n] === true}
                        onClick={() => answer(n, true)}
                      >
                        Load
                      </ToggleButton>
                    </ButtonGroup>
                  )}
                </ChoiceRow>
              );
            })}
          </Rows>
        </Stack>
      )}

      <Footer>
        <Text level="muted" size="sm" aria-live="polite">
          {questions &&
            (open === 0 ? "All answered" : `${open} still to answer`)}
        </Text>
        <Button
          variant="primary"
          type="button"
          disabled={open > 0}
          onClick={() =>
            onDone({
              uplinks: answers.map((value) => notice || value === true),
            })
          }
        >
          Continue
        </Button>
      </Footer>
    </Stack>
  );
}

const SectionHeading = styled.h3`
  margin: 0;
  font-size: var(--font-size-caption);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-muted);
`;

const Rows = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--color-border-subtle);
`;

const ChoiceRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-related-comfortable);
  padding: var(--gap-related) 0;
  border-bottom: 1px solid var(--color-border-subtle);
`;

const Meta = styled.span`
  font-size: var(--font-size-compact);
  font-weight: normal;
  color: var(--color-text-muted);
`;

const Footer = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-related-comfortable);
`;
