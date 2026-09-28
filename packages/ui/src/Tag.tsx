import styled, { css } from "styled-components";

export interface TagColours {
  bg: string;
  fg: string;
  border: string;
}

const TAG_COLOURS: Record<string, TagColours> = {
  telemetry: {
    bg: "var(--color-go-status)",
    fg: "var(--color-accent-fg)",
    border: "var(--color-go-status)",
  },
  control: {
    bg: "var(--color-tag-dark-brown-bg)",
    fg: "var(--color-tag-yellow-fg)",
    border: "var(--color-tag-dark-brown-border)",
  },
  system: {
    bg: "var(--color-tag-blue-bg)",
    fg: "var(--color-tag-blue-fg)",
    border: "var(--color-tag-blue-border)",
  },
  kos: {
    bg: "var(--color-tag-purple-bg)",
    fg: "var(--color-tag-purple-fg)",
    border: "var(--color-tag-blue-border)",
  },
};

const FALLBACK: TagColours = {
  bg: "var(--color-surface-panel)",
  fg: "var(--color-text-dim)",
  border: "var(--color-border-subtle)",
};

export function getTagColours(label: string): TagColours {
  return TAG_COLOURS[label] ?? FALLBACK;
}

export interface TagProps {
  label: string;
}

export function Tag({ label }: TagProps) {
  const colours = getTagColours(label);
  return (
    <TagBadge $bg={colours.bg} $fg={colours.fg} $border={colours.border}>
      {label}
    </TagBadge>
  );
}

const TagBadge = styled.span<{ $bg: string; $fg: string; $border: string }>`
  display: inline-block;
  padding: var(--inset-chip);
  border-radius: var(--radius-regular);
  font-size: var(--font-size-caption);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;

  ${({ $bg, $fg, $border }) => css`
    background: ${$bg};
    color: ${$fg};
    border: 1px solid ${$border};
  `}
`;
