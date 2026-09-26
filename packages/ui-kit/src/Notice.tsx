import type { ReactNode } from "react";
import styled from "styled-components";
import { Block__Root, type BlockProps, renderBlockAnatomy } from "./Block";
import { TONE_COLOR } from "./Card";
import type { ReadoutTone } from "./Readout";

export interface NoticeProps extends BlockProps {
  /**
   * What kind of statement this is, drawn as the banner's whole border rather
   * than a leading rule. A notice is read before it is read INTO, so the tone
   * has to reach the eye from the edge of the block.
   */
  tone?: ReadoutTone;
  /**
   * Interrupt rather than announce: `role="alert"` and `aria-live="assertive"`.
   *
   * For an event an operator must not finish their sentence before hearing,
   * which in this app means ABORT and nothing softer. Everything else is
   * `role="status" aria-live="polite"`, the default, because a banner that
   * barges in for an ordinary warning spends the loud channel and makes the
   * real one quieter.
   */
  assertive?: boolean;
  children?: ReactNode;
}

const Notice__Root = styled(Block__Root)<{ $tone: ReadoutTone }>`
  --gap-related: var(--gap-related-comfortable);

  background: var(--color-surface-sunken);
  border: 1px solid ${({ $tone }) => TONE_COLOR[$tone]};
  border-radius: var(--radius-regular);
  /* A banner IS its strip of the screen rather than one record among many, so
     it takes the roomier inset the two standalone card screens already reach
     for by name. */
  padding: var(--inset-surface-standalone);
`;

/**
 * A statement ABOUT the widget rather than a record inside it: what is limiting
 * the ship, which Uplinks were quarantined before import.
 *
 * Composed from `Block`'s parts and carrying its own surface, so the type and
 * spacing are the family's and the announcement contract is this component's.
 * It is the third consumer of one set of parts, which is the better argument
 * for the compound model than the escape hatch it was first accepted on: the
 * parts belong to the arrangement and are shared by every surface that wants
 * them, rather than belonging to `Card` and being borrowed.
 *
 * It does NOT get its own part namespace. Two doors to one object is an alias;
 * a third is a habit, and `Block` and `Card` already cover hand-composition.
 *
 * The live region is the whole reason this is not a toned `Card`. A card is a
 * record and announcing every record would flood a screen reader; a notice
 * exists precisely to be announced when it appears.
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
