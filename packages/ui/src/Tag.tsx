import styled, { css } from "styled-components";

// ---------------------------------------------------------------------------
// Colour map for known tags
// ---------------------------------------------------------------------------

export interface TagColours {
  bg: string;
  fg: string;
  border: string;
}

const TAG_COLOURS: Record<string, TagColours> = {
  telemetry: {
    bg: "var(--color-status-go-bg)",
    fg: "var(--color-accent-fg)",
    border: "var(--color-status-go-bg)",
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const TagBadge = styled.span<{ $bg: string; $fg: string; $border: string }>`
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: var(--font-size-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;

  ${({ $bg, $fg, $border }) => css`
    background: ${$bg};
    color: ${$fg};
    border: 1px solid ${$border};
  `}
`;
