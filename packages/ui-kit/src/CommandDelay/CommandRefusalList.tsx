import { commandRefusalSubject } from "@ksp-gonogo/sitrep-sdk";
import styled from "styled-components";
import {
  type CommandRefusalEntry,
  commandRefusalSentence,
} from "./commandRefusalSentence";
import { deriveGlyph } from "./toInFlightListItems";

/**
 * One refused dispatch as the rail renders it: the refusal itself, plus the two
 * things only the registering handle knows, its stable id and whether the
 * command is discrete or a stream.
 */
export interface RailRefusal extends CommandRefusalEntry {
  /**
   * `discrete` gets the same terse glyph tile its command carries in the
   * in-flight queue; `stream` gets its text label, because a continuous command
   * has no tile in that queue to match.
   */
  shape: "discrete" | "stream";
}

export interface CommandRefusalListProps {
  refusals: readonly RailRefusal[];
  /** Clear one refusal. Omitted when no handle can dismiss, and the boxes then
   *  carry no clear control rather than an inert one. */
  onDismiss?: (id: string) => void;
  ariaLabel?: string;
}

/**
 * The refusals under the rail's two queues: what the game said no to, and why.
 *
 * A box per refusal, warning-coloured, carrying the command's own identity (the
 * queue glyph it would have had, or its label for a stream) and the whole
 * sentence. The sentence WRAPS and is never truncated: craft and facility names
 * are user-supplied and unbounded, and truncation eats the numbers off the end,
 * which are the only actionable part of it.
 *
 * Renders nothing for an empty set, like every other member of this family.
 */
export function CommandRefusalList({
  refusals,
  onDismiss,
  ariaLabel = "Refused commands",
}: Readonly<CommandRefusalListProps>) {
  if (refusals.length === 0) return null;
  return (
    <CommandRefusalList__Root role="list" aria-label={ariaLabel}>
      {refusals.map((refusal) => {
        const subject = commandRefusalSubject(refusal);
        const sentence = commandRefusalSentence(refusal);
        return (
          <CommandRefusalList__Box key={refusal.id} role="listitem">
            {refusal.shape === "stream" ? (
              <CommandRefusalList__Label>
                {subject || refusal.command}
              </CommandRefusalList__Label>
            ) : (
              <CommandRefusalList__Glyph aria-hidden="true">
                {deriveGlyph(subject || refusal.command || "")}
              </CommandRefusalList__Glyph>
            )}
            <CommandRefusalList__Text>{sentence}</CommandRefusalList__Text>
            {onDismiss && (
              <CommandRefusalList__Dismiss
                type="button"
                onClick={(e) => {
                  // The rail is itself a button and this sits inside it, so a
                  // click here would otherwise also toggle the rail shut, taking
                  // the sentence away at the moment it is read.
                  e.stopPropagation();
                  onDismiss(refusal.id);
                }}
                aria-label={`Dismiss ${subject || "refusal"}`}
              >
                ✕
              </CommandRefusalList__Dismiss>
            )}
          </CommandRefusalList__Box>
        );
      })}
    </CommandRefusalList__Root>
  );
}

const CommandRefusalList__Root = styled.div`
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: var(--space-4, 4px);
  /* Matches the queue container's inset, so the boxes line up with the tiles
     above them rather than floating at their own margin. */
  margin: var(--space-4, 4px) var(--space-16, 16px);
`;

const CommandRefusalList__Box = styled.div`
  display: flex;
  align-items: flex-start;
  gap: var(--space-8, 8px);
  padding: var(--space-6, 6px) var(--space-8, 8px);
  border: 1px solid var(--color-status-warning-bg);
  border-radius: var(--radius-md, 4px);
  background: color-mix(
    in srgb,
    var(--color-status-warning-bg) 18%,
    var(--color-surface-raised)
  );
  color: var(--color-text-primary);
  text-align: left;
`;

/** The command's own terse identity, the same glyph its tile carries in the
 *  in-flight queue, so a refusal is recognisable as the thing that was sent. */
const CommandRefusalList__Glyph = styled.span`
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  min-width: 34px;
  padding: 0 var(--space-4, 4px);
  align-self: stretch;
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: var(--color-status-warning-fg);
  border: 1px solid var(--color-status-warning-bg);
  border-radius: var(--radius-sm, 3px);
  background: color-mix(
    in srgb,
    var(--color-status-warning-bg) 14%,
    var(--color-surface-raised)
  );
`;

/** A stream command's name in words. It has no queue tile to echo, so a glyph
 *  here would be an abbreviation of nothing the operator has seen. */
const CommandRefusalList__Label = styled.span`
  flex: 0 0 auto;
  align-self: center;
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: var(--color-status-warning-fg);
`;

const CommandRefusalList__Text = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--font-size-xs);
  line-height: var(--line-height-body);
  /* Wraps, never truncates: the numbers are at the end of the sentence. */
  overflow-wrap: anywhere;
`;

const CommandRefusalList__Dismiss = styled.button`
  flex: 0 0 auto;
  appearance: none;
  padding: 0 var(--space-4, 4px);
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
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;
