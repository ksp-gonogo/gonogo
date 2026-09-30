import type { Tone } from "@ksp-gonogo/sitrep-sdk";
import { type ReactNode, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { Block__Root, type BlockProps, renderBlockAnatomy } from "./Block";
import { LiveRegion } from "./LiveRegion";
import { toneEdge } from "./tone";

/**
 * Props for {@link Notice}: everything {@link BlockProps} takes, plus the
 * banner's tone and how loudly it is announced.
 *
 * @category EmptyState
 */
export interface NoticeProps extends BlockProps {
  /**
   * What kind of statement this is, drawn as the banner's whole border.
   * Defaults to `warn`.
   */
  tone?: Tone;
  /**
   * Interrupt rather than announce politely: the banner becomes
   * `role="alert"` with `aria-live="assertive"`. Keep it for an abort and
   * nothing softer.
   */
  assertive?: boolean;
  children?: ReactNode;
}

const Notice__Root = styled(Block__Root)<{ $tone: Tone }>`
  --gap-related: var(--gap-related-comfortable);
  --bleed-inline: 0px;

  background: var(--color-surface-sunken);
  border: 1px solid ${({ $tone }) => toneEdge($tone)};
  border-radius: var(--radius-regular);
  /* A banner is its own strip of the screen, so it takes the roomier inset. */
  padding: var(--inset-surface-standalone);
`;

/**
 * A banner stating something about the widget rather than a record inside it,
 * such as what is limiting the ship. It takes {@link Block}'s anatomy (title,
 * asides, footer) on a sunken surface bordered in its tone.
 *
 * Unlike a toned {@link Card}, a notice is announced to screen readers. By
 * default it is `role="note"` and its text is read out politely when it
 * appears and whenever its words change; with `assertive` it is
 * `role="alert"` and interrupts. A `role` passed by the caller replaces the
 * kit's and turns the announcement off.
 *
 * @example
 * ```tsx
 * <Notice tone="nogo" title="Thrust limited">
 *   Two engines are flamed out; available thrust is 48%.
 * </Notice>
 * ```
 *
 * @category EmptyState
 */
export function Notice({
  tone = "warn",
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
