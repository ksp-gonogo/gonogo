import styled, { css } from "styled-components";
import { focusRing } from "../focusRing";
import { LiveRegion } from "../LiveRegion";
import { type RailTags, railMark } from "./railTags";
import { deriveGlyph } from "./toInFlightListItems";

/**
 * One dead dispatch as the rail draws it: who it was and what became of it.
 * The sentence is composed by the caller; the box is the same for every
 * outcome.
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
   * The entry's three axes, of which only the MARK is read: a `dot` gets its
   * in-flight glyph tile, a `ribbon` its text label.
   */
  tags: RailTags;
}

export interface CommandOutcomeListProps {
  items: readonly CommandOutcomeItem[];
  /** Names the list for assistive tech, and says which outcome it holds. */
  ariaLabel: string;
  /** Clear one outcome. Omit it and the boxes carry no clear control rather than an inert one. */
  onDismiss?: (id: string) => void;
  /**
   * `warning` (the default) for an outcome that did not happen: a refusal, a
   * loss. `notice` for one that DID (a found), which must not wear the
   * warning's colour.
   */
  tone?: "warning" | "notice";
  /**
   * Announce arrivals politely (`role="status"` instead of `role="list"`), for
   * a list whose entries appear on their own rather than in answer to a press.
   */
  live?: boolean;
}

/**
 * The dead-dispatch boxes under the rail's two queues: one per outcome, with
 * the command's identity and the whole sentence. The sentence WRAPS and is
 * never truncated, since names are unbounded and the numbers sit at the end.
 *
 * Renders nothing for an empty set unless it is `live`: a live list keeps its
 * empty region mounted.
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
  // A live list stays mounted while empty so assistive tech is already watching when the first outcome arrives.
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

/** The same glyph the command's tile carries in the in-flight queue, so a dead command is recognisable. */
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

/** A stream command's name in words, since it has no queue tile to echo. */
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
