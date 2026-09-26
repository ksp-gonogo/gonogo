import type { ReactNode } from "react";
import styled from "styled-components";
import { Block__Root, type BlockProps, renderBlockAnatomy } from "./Block";
import { TONE_COLOR } from "./Card";
import type { ReadoutTone } from "./Readout";

export interface NoticeProps extends BlockProps {
  /**
   * What kind of statement this is, drawn as the banner's whole border so the
   * tone reaches the eye from the edge of the block.
   */
  tone?: ReadoutTone;
  /**
   * Interrupt rather than announce: `role="alert"` and `aria-live="assertive"`.
   *
   * For ABORT and nothing softer. Everything else takes the default
   * `role="status" aria-live="polite"`, so the loud channel stays meaningful.
   */
  assertive?: boolean;
  children?: ReactNode;
}

const Notice__Root = styled(Block__Root)<{ $tone: ReadoutTone }>`
  --gap-related: var(--gap-related-comfortable);

  background: var(--color-surface-sunken);
  border: 1px solid ${({ $tone }) => TONE_COLOR[$tone]};
  border-radius: var(--radius-regular);
  /* A banner is its own strip of the screen, so it takes the roomier inset. */
  padding: var(--inset-surface-standalone);
`;

/**
 * A statement about the widget rather than a record inside it: what is
 * limiting the ship, which Uplinks were quarantined before import.
 *
 * Composed from `Block`'s parts, with its own surface. It differs from a toned
 * `Card` by being a live region: a notice exists to be announced when it
 * appears, where announcing every record would flood a screen reader.
 */
export function Notice({
  tone = "warning",
  assertive = false,
  role,
  ...props
}: NoticeProps): ReactNode {
  return renderBlockAnatomy(Notice__Root, {
    ...props,
    role: role ?? (assertive ? "alert" : "status"),
    "aria-live": assertive ? "assertive" : "polite",
    $tone: tone,
  });
}
