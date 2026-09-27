import { commandRefusalSubject } from "@ksp-gonogo/sitrep-sdk";
import styled, { css } from "styled-components";
import { focusRing } from "../focusRing";
import { LiveRegion } from "../LiveRegion";
import { commandFoundSentence, type RailFound } from "./commandFoundSentence";
import { commandLossSentence, type RailLoss } from "./commandLossSentence";
import {
  commandRefusalSentence,
  type RailRefusal,
} from "./commandRefusalSentence";
import {
  commandUndeliveredSentence,
  type RailUndelivered,
} from "./commandUndeliveredSentence";
import { railMark } from "./railTags";
import { deriveGlyph } from "./toInFlightListItems";

/**
 * What became of the dispatches a `CommandList` draws:
 *
 * - `refused`: the game said no, and why
 * - `lost`: nothing answered, so the command may have run
 * - `undelivered`: it never left this machine, so a re-send repeats nothing
 * - `found`: a lost dispatch answered after all
 */
export type CommandListKind = "refused" | "lost" | "undelivered" | "found";

interface CommandListCommonProps {
  /** Clear one entry by its `id`. Omit it and the boxes carry no clear control rather than an inert one. */
  onDismiss?: (id: string) => void;
  /**
   * Announce each entry as it arrives (the default), as a polite live region
   * that stays mounted while empty. Off only where something else already
   * announces these outcomes, as the delay rail does; the list is then a plain
   * `role="list"` that draws nothing when empty.
   */
  live?: boolean;
  /** Names the list for assistive tech. Each kind has its own default. */
  ariaLabel?: string;
}

/**
 * The entries a `CommandList` draws, keyed by what became of them. Each entry
 * carries its dispatch's `requestId` as `id` and its command's rail axes as
 * `tags`; only the axes' mark is read, so a discrete command gets its
 * in-flight glyph tile and a continuous one its name in words.
 */
export type CommandListProps = CommandListCommonProps &
  (
    | { kind: "refused"; entries: readonly RailRefusal[] }
    | { kind: "lost"; entries: readonly RailLoss[] }
    | { kind: "undelivered"; entries: readonly RailUndelivered[] }
    | { kind: "found"; entries: readonly RailFound[] }
  );

/** One box as drawn: the kind's sentence and gesture already composed. */
interface CommandListBox {
  id: string;
  subject: string;
  sentence: string;
  dismissLabel: string;
  tags: RailRefusal["tags"];
}

const DEFAULT_LABEL: Record<CommandListKind, string> = {
  refused: "Refused commands",
  lost: "Commands with no reply",
  undelivered: "Commands that were never sent",
  found: "Lost commands that answered",
};

/** What the clear control names when a dispatch has no subject to name. */
const FALLBACK_DISMISS: Record<CommandListKind, string> = {
  refused: "refusal",
  lost: "loss",
  undelivered: "unsent command",
  found: "found command",
};

function sentenceOf(props: CommandListProps, index: number): string {
  if (props.kind === "refused")
    return commandRefusalSentence(props.entries[index]);
  if (props.kind === "found") return commandFoundSentence(props.entries[index]);
  if (props.kind === "undelivered") {
    return commandUndeliveredSentence(props.entries[index]);
  }
  return commandLossSentence(props.entries[index]);
}

function boxesOf(props: CommandListProps): CommandListBox[] {
  return props.entries.map((entry, index) => {
    const subject = commandRefusalSubject(entry);
    return {
      id: entry.id,
      subject: subject || entry.command || "",
      sentence: sentenceOf(props, index),
      dismissLabel: `Dismiss ${subject || FALLBACK_DISMISS[props.kind]}`,
      tags: entry.tags,
    };
  });
}

/**
 * The outcome boxes under the delay rail's two queues: one per dispatch, with
 * the command's identity and the whole sentence of what became of it. The
 * sentence wraps and is never truncated, since names are unbounded and the
 * numbers sit at the end. A `found` is drawn in the notice tone, every other
 * kind in the warning tone, because a found reports something that happened.
 *
 * The sentences are the kit's `commandRefusalSentence`, `commandLossSentence`,
 * `commandUndeliveredSentence` and `commandFoundSentence`, exported so a
 * surface that draws the same outcome elsewhere says it in the same words.
 */
export function CommandList(props: Readonly<CommandListProps>) {
  const { kind, onDismiss, live = true } = props;
  const ariaLabel = props.ariaLabel ?? DEFAULT_LABEL[kind];
  const tone: OutcomeTone = kind === "found" ? "notice" : "warning";
  if (!live && props.entries.length === 0) return null;
  const boxes = boxesOf(props).map((box) => (
    <CommandList__Box
      key={box.id}
      role={live ? undefined : "listitem"}
      $tone={tone}
    >
      {railMark(box.tags) === "ribbon" ? (
        <CommandList__Label $tone={tone}>{box.subject}</CommandList__Label>
      ) : (
        <CommandList__Glyph aria-hidden="true" $tone={tone}>
          {deriveGlyph(box.subject)}
        </CommandList__Glyph>
      )}
      <CommandList__Text>{box.sentence}</CommandList__Text>
      {onDismiss && (
        <CommandList__Dismiss
          type="button"
          onClick={() => onDismiss(box.id)}
          aria-label={box.dismissLabel}
        >
          ✕
        </CommandList__Dismiss>
      )}
    </CommandList__Box>
  ));
  // A live list stays mounted while empty so assistive tech is already watching when the first outcome arrives.
  if (live) {
    return (
      <CommandList__Region
        forwardedAs="div"
        aria-label={ariaLabel}
        additionsOnly
      >
        {boxes}
      </CommandList__Region>
    );
  }
  return (
    <CommandList__Root role="list" aria-label={ariaLabel}>
      {boxes}
    </CommandList__Root>
  );
}

const outcomeListLayout = css`
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: var(--gap-message-stack);
  /* Matches the queue container's inset, so the boxes line up with the tiles above. */
  margin: var(--outset-command-strip);
`;

const CommandList__Root = styled.div`
  ${outcomeListLayout}
`;

const CommandList__Region = styled(LiveRegion)`
  ${outcomeListLayout}
  &:empty {
    margin: 0;
  }
`;

/** `warning` for an outcome that did NOT happen (a refusal, a loss), `notice` for one that did after all (a found). */
type OutcomeTone = "warning" | "notice";

const toneBg = (tone: OutcomeTone) =>
  tone === "notice"
    ? "var(--color-status-info-bg)"
    : "var(--color-status-warning-bg)";
const toneFg = (tone: OutcomeTone) =>
  tone === "notice"
    ? "var(--color-status-info-fg)"
    : "var(--color-status-warning-fg-muted)";
/** The box's edge: a tone colour that shows against the panel it sits on. */
const toneEdge = (tone: OutcomeTone) =>
  tone === "notice"
    ? "var(--color-status-info-fg)"
    : "var(--color-status-warning-bg)";

const CommandList__Box = styled.div<{ $tone: OutcomeTone }>`
  display: flex;
  align-items: flex-start;
  gap: var(--gap-glyph-box);
  padding: var(--inset-surface);
  border: 1px solid ${({ $tone }) => toneEdge($tone)};
  border-radius: var(--radius-regular);
  background: ${({ $tone }) =>
    `color-mix(in srgb, ${toneBg($tone)} 18%, var(--color-surface-raised))`};
  color: var(--color-text-primary);
  text-align: left;
`;

/** The same glyph the command's tile carries in the in-flight queue, so a dead command is recognisable. */
const CommandList__Glyph = styled.span<{ $tone: OutcomeTone }>`
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  min-width: 34px;
  padding: var(--inset-glyph);
  align-self: stretch;
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: ${({ $tone }) => toneFg($tone)};
  border: 1px solid ${({ $tone }) => toneEdge($tone)};
  border-radius: var(--radius-regular);
  background: ${({ $tone }) =>
    `color-mix(in srgb, ${toneBg($tone)} 14%, var(--color-surface-raised))`};
`;

/** A stream command's name in words, since it has no queue tile to echo. */
const CommandList__Label = styled.span<{ $tone: OutcomeTone }>`
  flex: 0 0 auto;
  align-self: center;
  font-size: var(--font-size-compact);
  font-weight: 700;
  color: ${({ $tone }) => toneFg($tone)};
`;

const CommandList__Text = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--font-size-compact);
  line-height: var(--line-height-body);
  /* Wraps, never truncates: the numbers are at the end of the sentence. */
  overflow-wrap: anywhere;
`;

const CommandList__Dismiss = styled.button`
  flex: 0 0 auto;
  appearance: none;
  padding: var(--inset-glyph);
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--font-size-xs);
  cursor: pointer;

  &:hover,
  &:focus-visible {
    color: var(--color-text-primary);
  }
  ${focusRing}
`;
