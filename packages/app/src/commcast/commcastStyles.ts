import { Button, ScrollArea } from "@ksp-gonogo/ui-kit";
import styled from "styled-components";

/** Words are informational, so this console takes the info tone where the terminal it shares parts with takes the accent. */
export const COMMCAST_TONE = "info" as const;

export const Commcast__Frame = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 auto;
  gap: var(--gap-related);
`;

export const Commcast__Identity = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
`;

// The row above the console in all three views; non-growing, so switching view never resizes the console.
export const Commcast__Bar = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
  flex: 0 0 auto;
  min-width: 0;
`;

/** Pushes what follows to the far end of a bar. */
export const Commcast__BarGap = styled.div`
  flex: 1 1 auto;
`;

// The only arbitrarily long thing on the bar, so the only thing that gives way; a wrapped title would change the tile's height.
export const Commcast__BarTitle = styled.span`
  flex: 0 1 auto;
  min-width: 0;
  font-size: var(--font-size-value);
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

// The key and the mute keep their size in the bar's corner, so they are in the same place whatever the conversation is called.
export const Commcast__BarRadio = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
  flex: 0 0 auto;
`;

export const Commcast__Back = styled(Button).attrs({ variant: "ghost" })`
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  font-size: var(--font-size-compact);
`;

/*
 * The log's inset goes on the scrolling children, because Console draws to
 * its border with no gutter. The inner is a flex column so Commcast__List's
 * auto top margin pins a short log to the bottom, next to the composer.
 */
export const Commcast__Scroll = styled(ScrollArea)`
  & [data-scroll-area-inner] {
    display: flex;
    flex-direction: column;
    padding: var(--inset-log);
  }
`;

export const Commcast__List = styled.div`
  display: flex;
  flex-direction: column;
  /* Pins a short log to the frame's bottom. */
  margin-top: auto;
  gap: var(--gap-related);
`;

// A list of choices reads from its first row, so unlike the log it starts at the top.
export const Commcast__Rows = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

// Inherits SelectableRow's colour, so the selected state shows on the name.
export const Commcast__RowName = styled.span`
  font-size: var(--font-size-value);
  color: inherit;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

export const Commcast__RowHead = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--gap-related);
  width: 100%;
  min-width: 0;
`;

// One clipped line, so an inbox row stays scannable whatever it previews.
export const Commcast__Preview = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
`;

// A rule across the log with a word on it, so a boundary can never be misread as a message.
export const ThreadMarker = styled.div<{ $blocked?: boolean }>`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
  font-size: var(--font-size-caption);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${({ $blocked }) =>
    $blocked ? "var(--color-nogo-text)" : "var(--color-text-faint)"};

  &::before,
  &::after {
    content: "";
    flex: 1 1 auto;
    border-top: 1px solid
      ${({ $blocked }) =>
        $blocked ? "var(--color-nogo-text)" : "var(--color-border-subtle)"};
  }
`;

export const Commcast__Message = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-line);
`;

export const Commcast__Meta = styled.div`
  display: flex;
  align-items: baseline;
  gap: var(--gap-related);
  flex-wrap: wrap;
`;

export const Author = styled.span<{ $pilot: boolean }>`
  font-size: var(--font-size-compact);
  font-weight: 600;
  color: ${({ $pilot }) =>
    $pilot ? "var(--color-go-text)" : "var(--color-info-mark)"};
`;

// A membership change reads as something that happened to the thread rather than as words somebody said.
export const Commcast__Body = styled.p<{ $change?: boolean }>`
  margin: 0;
  font-size: var(--font-size-value);
  color: ${({ $change }) =>
    $change ? "var(--color-text-muted)" : "var(--color-text-primary)"};
  font-style: ${({ $change }) => ($change ? "italic" : "normal")};
  overflow-wrap: anywhere;
`;

export const Commcast__Actions = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
  flex-wrap: wrap;
`;

// Flush on the ComposerBar, which is already the bordered band; the focus ring takes the console's tone.
export const Commcast__Input = styled.input`
  flex: 1 1 auto;
  min-width: 0;
  font: inherit;
  font-size: var(--font-size-value);
  color: var(--color-text-primary);
  background: transparent;
  border: none;
  padding: var(--inset-line);

  &:focus-visible {
    outline: 2px solid var(--console-tone-fg, var(--color-accent-fg));
    outline-offset: 2px;
  }
`;
