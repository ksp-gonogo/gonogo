import type { Tone } from "@ksp-gonogo/sitrep-sdk";
import styled from "styled-components";
import { focusRing } from "./focusRing";
import { Tooltip } from "./Tooltip";
import { TONE_MARK, TONE_TEXT } from "./tone";

/**
 * One person in an {@link AvatarStack}.
 *
 * @category Badge
 */
export interface AvatarStackItem {
  /** Stable key. */
  id: string;
  /** The full name: the avatar's tooltip and accessible name. The initials are drawn from it. */
  name: string;
  /** Colours the avatar's edge and initials. Absent, neutral. */
  tone?: Tone;
  /** Makes this avatar a button that calls this when pressed. Absent, the avatar is not a control. */
  onSelect?: () => void;
}

/**
 * Props for {@link AvatarStack}.
 *
 * @category Badge
 */
export interface AvatarStackProps {
  /** Everyone to show, in order. The first ones are drawn and the rest fold into the overflow count. */
  items: readonly AvatarStackItem[];
  /**
   * How many places the stack has, the overflow count included. The stack
   * reserves this many places whatever `items` holds, so it never changes size.
   * Absent, 3.
   */
  max?: number;
  /** Names the group for assistive technology, when it is not already labelled by its surroundings. */
  label?: string;
}

/**
 * Up to two letters standing for a name: the first letters of its first two
 * words, or the first two letters of a single word.
 *
 * @category Badge
 */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters =
    parts.length === 1
      ? Array.from(parts[0] ?? "").slice(0, 2)
      : parts.slice(0, 2).map((word) => Array.from(word)[0] ?? "");
  return letters.join("").toUpperCase();
}

const DEFAULT_MAX = 3;

/**
 * A row of small round initials badges, overlapped, for showing who is
 * involved in something without room for their names. Each avatar's tooltip
 * and accessible name is the full name.
 *
 * Its footprint is fixed by `max` and never by the number of items: with more
 * people than places, the last place becomes a "+k" count whose tooltip lists
 * the names it hides, and with fewer the unused places stay empty.
 *
 * @example
 * ```tsx
 * <AvatarStack
 *   label="Speaking"
 *   items={[{ id: "a", name: "Ares 4" }, { id: "w", name: "Woomera Range" }]}
 * />
 * ```
 *
 * @category Badge
 */
export function AvatarStack({
  items,
  max = DEFAULT_MAX,
  label,
}: AvatarStackProps) {
  const places = Math.max(1, Math.floor(max));
  const overflowing = items.length > places;
  const shown = overflowing ? items.slice(0, places - 1) : items;
  const hidden = overflowing ? items.slice(places - 1) : [];
  return (
    <AvatarStack__Row
      $places={places}
      role="group"
      {...(label === undefined ? {} : { "aria-label": label })}
    >
      {shown.map((item) => (
        <Tooltip
          key={item.id}
          text={item.name}
          announce={false}
          focusable={item.onSelect === undefined}
        >
          {item.onSelect === undefined ? (
            <AvatarStack__Face
              $tone={item.tone}
              role="img"
              aria-label={item.name}
            >
              {initialsOf(item.name)}
            </AvatarStack__Face>
          ) : (
            <AvatarStack__Face
              as="button"
              type="button"
              $tone={item.tone}
              aria-label={item.name}
              onClick={item.onSelect}
            >
              {initialsOf(item.name)}
            </AvatarStack__Face>
          )}
        </Tooltip>
      ))}
      {hidden.length > 0 && (
        <Tooltip
          text={hidden.map((item) => item.name).join(", ")}
          announce={false}
          focusable
        >
          <AvatarStack__Face
            $tone={undefined}
            role="img"
            aria-label={`${hidden.length} more: ${hidden.map((item) => item.name).join(", ")}`}
          >
            +{hidden.length}
          </AvatarStack__Face>
        </Tooltip>
      )}
    </AvatarStack__Row>
  );
}

const AvatarStack__Row = styled.div<{ $places: number }>`
  /* Two insets short of a control, so a stack in a bordered control of that height always fits inside it. */
  --avatar-size: calc(var(--control-height) - 2 * var(--inset-avatar));
  /*
   * Initials are centred, so the later badge must leave the earlier one's
   * letters clear: the step is nearly the whole badge and only a sliver of
   * edge is covered.
   */
  --avatar-step: calc(var(--avatar-size) * 0.92);
  display: flex;
  align-items: center;
  flex: none;
  block-size: var(--avatar-size);
  /* One place is a whole avatar and every further one only its uncovered part. */
  inline-size: calc(
    var(--avatar-size) + (${({ $places }) => $places} - 1) * var(--avatar-step)
  );
`;

const AvatarStack__Face = styled.span<{ $tone: Tone | undefined }>`
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: var(--avatar-size);
  block-size: var(--avatar-size);
  margin: 0;
  padding: 0;
  border: 1px solid ${({ $tone }) => TONE_MARK[$tone ?? "neutral"]};
  border-radius: var(--radius-circle);
  background: var(--color-surface-raised);
  color: ${({ $tone }) => TONE_TEXT[$tone ?? "neutral"]};
  font: inherit;
  font-size: var(--font-size-caption);
  font-weight: 600;
  line-height: var(--line-height-flush);
  white-space: nowrap;
  /* Each avatar overlaps the one before it, which stays on top. */
  &:not(:first-child) {
    margin-inline-start: calc(var(--avatar-step) - var(--avatar-size));
  }
  &:is(button) {
    cursor: pointer;
  }
  ${focusRing}
  &:focus-visible {
    position: relative;
  }
`;
