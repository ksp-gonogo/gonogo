import styled from "styled-components";

/**
 * One key of the keyboard, drawn as a small squared keycap around its name
 * ("Ctrl", "Z", "Enter"), as a real `kbd` element. Write a combination as one
 * `Kbd` per key with a "+" between them. Useful for showing the operator which
 * keys to press at a glance, rather than spelling the keys out in a sentence.
 * Used by the Help page's list of keyboard shortcuts.
 *
 * @category Typography
 */
export const Kbd = styled.kbd`
  display: inline-block;
  padding: var(--inset-chip);
  border-radius: var(--radius-regular);
  border: 1px solid var(--color-border-subtle);
  background: var(--color-surface-panel);
  color: var(--color-text-primary);
  font-family: inherit;
  font-size: var(--font-size-caption);
  font-weight: 600;
  line-height: var(--line-height-body);
  white-space: nowrap;
`;
