import styled from "styled-components";
import { deriveGlyph } from "./toInFlightListItems";

/**
 * One dead dispatch as the rail draws it, reduced to what the box needs: who
 * it was and what became of it.
 *
 * The composing is the caller's, because the two outcomes that reach here say
 * different kinds of thing. A refusal quotes the game's verdict and its
 * numbers; a loss quotes no verdict at all, because nothing was decided. The
 * BOX is identical for both, which is why it lives in one place.
 */
export interface CommandOutcomeItem {
  /** The dispatch's own `requestId`, which keys the box and is what `dismiss` takes. */
  id: string;
  /** The command's own identity: abbreviated into the glyph tile for a discrete command, spelled out for a stream. */
  subject: string;
  /** The whole sentence, already composed. */
  sentence: string;
  /** The clear control's accessible name, so each outcome names its own gesture. */
  dismissLabel: string;
  /**
   * `discrete` gets the same terse glyph tile its command carries in the
   * in-flight queue; `stream` gets its text label, because a continuous command
   * has no tile in that queue to match.
   */
  shape: "discrete" | "stream";
}

export interface CommandOutcomeListProps {
  items: readonly CommandOutcomeItem[];
  /** Names the list for assistive tech, and says which outcome it holds. */
  ariaLabel: string;
  /** Clear one outcome. Omitted when no handle can dismiss, and the boxes then
   *  carry no clear control rather than an inert one. */
  onDismiss?: (id: string) => void;
  /**
   * `warning` (the default) for an outcome that did not happen: a refusal, a
   * loss. `notice` for one that DID, which is only `found` today. The colour is
   * the fastest thing an operator reads off this list, so an outcome that
   * reverses a warning must not wear the warning's own colour.
   */
  tone?: "warning" | "notice";
  /**
   * Announce arrivals politely, for a list whose entries appear on their own
   * rather than in answer to a press. `role="status"` (implicitly
   * `aria-live="polite"`) instead of the plain `role="list"`; never assertive,
   * which is reserved for ABORT.
   */
  live?: boolean;
}

/**
 * The dead-dispatch boxes under the rail's two queues.
 *
 * A box per outcome, warning-coloured, carrying the command's own identity (the
 * queue glyph it would have had, or its label for a stream) and the whole
 * sentence. The sentence WRAPS and is never truncated: craft and facility names
 * are user-supplied and unbounded, and truncation eats the numbers off the end,
 * which are the only actionable part of it.
 *
 * Renders nothing for an empty set, like every other member of this family.
 */
export function CommandOutcomeList({
  items,
  ariaLabel,
  onDismiss,
  tone = "warning",
  live = false,
}: Readonly<CommandOutcomeListProps>) {
  if (items.length === 0) return null;
  return (
    <CommandOutcomeList__Root
      /* `status` is a live region AND a landmark-ish container: it carries its
         own children fine, but it is not a list, so the rows drop `listitem`
         with it rather than being orphaned items inside a non-list. */
      role={live ? "status" : "list"}
      aria-label={ariaLabel}
    >
      {items.map((item) => (
        <CommandOutcomeList__Box
          key={item.id}
          role={live ? undefined : "listitem"}
          $tone={tone}
        >
          {item.shape === "stream" ? (
            <CommandOutcomeList__Label $tone={tone}>
              {item.subject}
            </CommandOutcomeList__Label>
          ) : (
            <CommandOutcomeList__Glyph aria-hidden="true" $tone={tone}>
              {deriveGlyph(item.subject)}
            </CommandOutcomeList__Glyph>
          )}
          <CommandOutcomeList__Text>{item.sentence}</CommandOutcomeList__Text>
          {onDismiss && (
            <CommandOutcomeList__Dismiss
              type="button"
              onClick={(e) => {
                /*
                 * The rail is itself a button and this sits inside it, so a
                 * click here would otherwise also toggle the rail shut, taking
                 * the sentence away at the moment it is read.
                 */
                e.stopPropagation();
                onDismiss(item.id);
              }}
              aria-label={item.dismissLabel}
            >
              ✕
            </CommandOutcomeList__Dismiss>
          )}
        </CommandOutcomeList__Box>
      ))}
    </CommandOutcomeList__Root>
  );
}

const CommandOutcomeList__Root = styled.div`
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: var(--space-4, 4px);
  /* Matches the queue container's inset, so the boxes line up with the tiles
     above them rather than floating at their own margin. */
  margin: var(--space-4, 4px) var(--space-16, 16px);
`;

/**
 * The two colour roles this family draws in. `warning` for an outcome that did
 * NOT happen (a refusal, a loss), `notice` for one that did after we said it had
 * not (a found).
 */
type OutcomeTone = "warning" | "notice";

const toneBg = (tone: OutcomeTone) =>
  tone === "notice"
    ? "var(--color-status-info-bg)"
    : "var(--color-status-warning-bg)";
const toneFg = (tone: OutcomeTone) =>
  tone === "notice"
    ? "var(--color-status-info-fg)"
    : "var(--color-status-warning-fg)";

const CommandOutcomeList__Box = styled.div<{ $tone: OutcomeTone }>`
  display: flex;
  align-items: flex-start;
  gap: var(--space-8, 8px);
  padding: var(--space-6, 6px) var(--space-8, 8px);
  border: 1px solid ${({ $tone }) => toneBg($tone)};
  border-radius: var(--radius-md, 4px);
  background: ${({ $tone }) =>
    `color-mix(in srgb, ${toneBg($tone)} 18%, var(--color-surface-raised))`};
  color: var(--color-text-primary);
  text-align: left;
`;

/** The command's own terse identity, the same glyph its tile carries in the
 *  in-flight queue, so a dead command is recognisable as the thing that was sent. */
const CommandOutcomeList__Glyph = styled.span<{ $tone: OutcomeTone }>`
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  min-width: 34px;
  padding: 0 var(--space-4, 4px);
  align-self: stretch;
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: ${({ $tone }) => toneFg($tone)};
  border: 1px solid ${({ $tone }) => toneBg($tone)};
  border-radius: var(--radius-sm, 3px);
  background: ${({ $tone }) =>
    `color-mix(in srgb, ${toneBg($tone)} 14%, var(--color-surface-raised))`};
`;

/** A stream command's name in words. It has no queue tile to echo, so a glyph
 *  here would be an abbreviation of nothing the operator has seen. */
const CommandOutcomeList__Label = styled.span<{ $tone: OutcomeTone }>`
  flex: 0 0 auto;
  align-self: center;
  font-size: var(--font-size-xs);
  font-weight: 700;
  color: ${({ $tone }) => toneFg($tone)};
`;

const CommandOutcomeList__Text = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--font-size-xs);
  line-height: var(--line-height-body);
  /* Wraps, never truncates: the numbers are at the end of the sentence. */
  overflow-wrap: anywhere;
`;

const CommandOutcomeList__Dismiss = styled.button`
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
