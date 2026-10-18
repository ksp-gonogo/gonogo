// The first-load page (design §3.5). Because the loader runs pre-render, before
// the app's React tree and its ModalProvider exist, this mounts a one-off modal
// into its own `createRoot`, resolves once the operator has answered every
// question on it, then unmounts. `main.tsx` wires it via `setConsentBatchPrompt`.
//
// Each Uplink row names who vouched for its identity and who only claims it:
// the mod vouches for its client, but a compromised mod could vouch for a
// compromised client, so mod trust comes from CKAN, not from us.

import { useId, useRef } from "react";
import { createRoot } from "react-dom/client";
import styled, { type DefaultTheme, ThemeProvider } from "styled-components";
import { isolateModal } from "../a11y/modalIsolation";
import { useFocusTrap } from "../a11y/useFocusTrap";
import type { ConsentInfo } from "./consent";
import { type FirstLoadAnswers, FirstLoadChoices } from "./FirstLoadChoices";

// The rem sizes below are root-relative on purpose: this is a pre-render surface that scales with the browser font size.
const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.82);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-critical);
`;

const Dialog = styled.div`
  background: var(--color-surface-raised);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-floating);
  max-width: 640px;
  width: calc(100% - 2rem);
  max-height: calc(100vh - 2rem);
  max-height: calc(100dvh - 2rem);
  overflow-y: auto;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: var(--gap-related-comfortable);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);

  h2 {
    margin: 0;
    font-size: 1.1rem;
  }
  &:focus-visible,
  button:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;

export interface FirstLoadPageProps {
  uplinks: readonly ConsentInfo[];
  onDone: (answers: FirstLoadAnswers) => void;
}

/** The first-load questions in the dialog that holds them. */
export function FirstLoadPage({
  uplinks,
  onDone,
}: Readonly<FirstLoadPageProps>) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  return (
    <Backdrop>
      <Dialog
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 id={titleId}>Before you start</h2>
        <FirstLoadChoices uplinks={uplinks} onDone={onDone} />
      </Dialog>
    </Backdrop>
  );
}

/**
 * Mount the first-load page, resolve once every question is answered (or
 * Escape answers what is left), and tear the one-off root down. Returns one
 * answer per Uplink, in the order given. `theme` is the app's active
 * styled-components theme, so the page renders in the palette of the app it
 * is about to extend.
 */
export function promptForConsents(
  uplinks: readonly ConsentInfo[],
  theme: DefaultTheme,
): Promise<boolean[]> {
  return new Promise<boolean[]>((resolve) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    // This can open while another modal is already up behind it, so whatever is behind is isolated until it closes.
    const release = isolateModal(container);

    const finish = (answers: FirstLoadAnswers): void => {
      release();
      root.unmount();
      container.remove();
      resolve(answers.uplinks);
    };

    root.render(
      <ThemeProvider theme={theme}>
        <FirstLoadPage uplinks={uplinks} onDone={finish} />
      </ThemeProvider>,
    );
  });
}
