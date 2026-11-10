import { Button, Text } from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import styled from "styled-components";
import { listInWords, missingAfterTakeover } from "./takeoverMissing";

/**
 * Says that this screen has just become the host, and names what it does not
 * have from the host before it. Shown once, on the screen that took over, until
 * dismissed.
 */
export function TakeoverNotice({
  storage,
}: {
  /** Where the host keeps its notes, alarms and thread; this browser's by default. */
  storage?: Storage;
}) {
  const [missing] = useState(() => missingAfterTakeover(storage));
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <TakeoverNotice__Banner role="status" aria-live="polite">
      <Text size="xs">
        This screen is now the host. It does not have the previous host's{" "}
        {listInWords(missing)}.
      </Text>
      <Button onClick={() => setDismissed(true)}>Dismiss</Button>
    </TakeoverNotice__Banner>
  );
}

/* At the top edge: the bottom edge is the banner stack's, where a join request waits for an answer. */
const TakeoverNotice__Banner = styled.div`
  position: fixed;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: var(--z-sticky);
  display: flex;
  align-items: center;
  gap: var(--gap-related);
  width: max-content;
  max-width: calc(100vw - 2 * var(--gutter-screen) - 5rem);
  padding: var(--inset-surface);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-info-mark);
  border-top: none;
  border-radius: 0 0 var(--radius-regular) var(--radius-regular);
`;
