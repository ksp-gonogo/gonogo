import styled, { css } from "styled-components";
import { focusRing } from "../focusRing";
import { LiveRegion } from "../LiveRegion";
import { type RailTags, railMark } from "./railTags";
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
   * The entry's three axes, of which only the MARK is read here: a `dot`
   * (discrete) gets the same terse glyph tile its command carries in the
   * in-flight queue, a `ribbon` (continuous) gets its text label, because a
   * continuous command has no tile in that queue to match.
   */
  tags: RailTags;
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
   * `aria-live="polite"`) instead of the plain `role="list"`, each new box read
   * on its own; never assertive, which is reserved for ABORT.
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
 * Renders nothing for an empty set, like every other member of this family,
 * unless it is `live`: a live list keeps its empty region mounted.
 */
export function CommandOutcomeList({
  items,
  ariaLabel,
  onDismiss,
  tone = "warning",
  live = false,
}: Readonly<CommandOutcomeListProps>) {
  if (!live && items.length === 0) return null;
  const boxes = items.map((item) => (
    <CommandOutcomeList__Box
      key={item.id}
      role={live ? undefined : "listitem"}
      $tone={tone}
    >
      {railMark(item.tags) === "ribbon" ? (
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
          onClick={() => onDismiss(item.id)}
          aria-label={item.dismissLabel}
        >
          ✕
        </CommandOutcomeList__Dismiss>
      )}
    </CommandOutcomeList__Box>
  ));
  /* A live list stays mounted, empty, while it has nothing to report, so the
     first outcome to arrive is a change to a region assistive tech is already
     watching. It is a status region rather than a list, so its boxes carry no
     `listitem` role. */
  return live ? (
    <CommandOutcomeList__Region
      forwardedAs="div"
      aria-label={ariaLabel}
      additionsOnly
    >
      {boxes}
    </CommandOutcomeList__Region>
  ) : (
    <CommandOutcomeList__Root role="list" aria-label={ariaLabel}>
      {boxes}
    </CommandOutcomeList__Root>
  );
}

const outcomeListLayout = css`
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: var(--gap-message-stack);
  /* Matches the queue container's inset, so the boxes line up with the tiles
     above them rather than floating at their own margin. */
  margin: var(--outset-command-strip);
`;

const CommandOutcomeList__Root = styled.div`
  ${outcomeListLayout}
`;

const CommandOutcomeList__Region = styled(LiveRegion)`
  ${outcomeListLayout}
  &:empty {
    margin: 0;
  }
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
    : "var(--color-status-warning-fg-muted)";
/** The box's edge: a tone colour that shows against the panel it sits on. */
const toneEdge = (tone: OutcomeTone) =>
  tone === "notice"
    ? "var(--color-status-info-fg)"
    : "var(--color-status-warning-bg)";

const CommandOutcomeList__Box = styled.div<{ $tone: OutcomeTone }>`
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

/** The command's own terse identity, the same glyph its tile carries in the
 *  in-flight queue, so a dead command is recognisable as the thing that was sent. */
const CommandOutcomeList__Glyph = styled.span<{ $tone: OutcomeTone }>`
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

/** A stream command's name in words. It has no queue tile to echo, so a glyph
 *  here would be an abbreviation of nothing the operator has seen. */
const CommandOutcomeList__Label = styled.span<{ $tone: OutcomeTone }>`
  flex: 0 0 auto;
  align-self: center;
  font-size: var(--font-size-compact);
  font-weight: 700;
  color: ${({ $tone }) => toneFg($tone)};
`;

const CommandOutcomeList__Text = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  font-size: var(--font-size-compact);
  line-height: var(--line-height-body);
  /* Wraps, never truncates: the numbers are at the end of the sentence. */
  overflow-wrap: anywhere;
`;

const CommandOutcomeList__Dismiss = styled.button`
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
