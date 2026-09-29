import { type ReactNode, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { Block__Root, type BlockProps, renderBlockAnatomy } from "./Block";
import { TONE_COLOR } from "./Card";
import { LiveRegion } from "./LiveRegion";
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
  --bleed-inline: 0px;

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
 * `Card` by being announced: a notice exists to be heard when it appears, where
 * announcing every record would flood a screen reader. A polite notice speaks
 * through a hidden live region mounted empty and filled once it is in the
 * document, since a region inserted already holding its words is often never
 * read. An assertive one is `role="alert"`, which is announced on insertion.
 * A caller's `role` replaces the kit's and brings no `aria-live` with it.
 */
export function Notice({
  tone = "warning",
  assertive = false,
  role,
  children,
  ...props
}: NoticeProps): ReactNode {
  const rootRef = useRef<HTMLElement>(null);
  const [said, setSaid] = useState("");
  useEffect(() => {
    const root = rootRef.current;
    if (assertive || role !== undefined || root === null) return;
    const text = spokenText(root);
    setSaid((previous) => (previous === text ? previous : text));
  });

  if (assertive) {
    return renderBlockAnatomy(Notice__Root, {
      ...props,
      children,
      role: role ?? "alert",
      "aria-live": role === undefined ? "assertive" : undefined,
      $tone: tone,
    });
  }
  const block = renderBlockAnatomy(Notice__Root, {
    ...props,
    children,
    ref: rootRef,
    // A note, so a caller's `aria-label` names something that may carry a name.
    role: role ?? "note",
    $tone: tone,
  });
  if (role !== undefined) return block;
  return (
    <>
      {block}
      <LiveRegion visuallyHidden>{said}</LiveRegion>
    </>
  );
}

/**
 * The notice's words. Text runs are joined with a space, so a title and the
 * body under it do not read as one word.
 */
function spokenText(root: HTMLElement): string {
  const runs: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    runs.push(node.textContent ?? "");
  }
  return runs.join(" ").replace(/\s+/g, " ").trim();
}
