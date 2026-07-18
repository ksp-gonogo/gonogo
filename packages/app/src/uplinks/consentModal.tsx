// The first-load consent modal (design §3.5 / D-consent option A). Because the
// loader runs pre-render — before the app's React tree and its ModalProvider
// exist — this mounts a one-off modal into its own `createRoot`, resolves on the
// operator's click, then unmounts. `main.tsx` wires it via `setConsentPrompt`.
//
// It names the Uplink / author / version and states the §3.5 limit: the mod
// vouches for this client, but a compromised mod could vouch for a compromised
// client — mod trust comes from CKAN, not from us.

import { GhostButton, PrimaryButton } from "@ksp-gonogo/ui";
import { useEffect, useId, useRef } from "react";
import { createRoot } from "react-dom/client";
import styled, { type DefaultTheme, ThemeProvider } from "styled-components";
import type { ConsentInfo } from "./consent";

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
`;

const Dialog = styled.div`
  background: var(--color-surface-raised);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-strong);
  border-radius: 8px;
  max-width: 460px;
  width: calc(100% - 2rem);
  padding: 1.5rem;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);

  h2 {
    margin: 0 0 0.75rem;
    font-size: 1.1rem;
  }
  p {
    margin: 0 0 0.75rem;
    line-height: 1.45;
    font-size: 0.9rem;
  }
  .UplinkConsent__meta {
    color: var(--color-text-muted);
    font-size: 0.85rem;
  }
  .UplinkConsent__limit {
    color: var(--color-status-warning-fg);
    font-size: 0.82rem;
  }
  .UplinkConsent__actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 1.25rem;
  }
  button:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;

interface ConsentDialogProps {
  info: ConsentInfo;
  onResolve: (granted: boolean) => void;
}

function ConsentDialog({ info, onResolve }: Readonly<ConsentDialogProps>) {
  const titleId = useId();
  const descId = useId();
  const loadRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    loadRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onResolve(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onResolve]);

  return (
    <Backdrop>
      <Dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <h2 id={titleId}>Load Uplink “{info.name}”?</h2>
        <p className="UplinkConsent__meta">
          {info.id}@{info.version}
          {info.author ? ` · by ${info.author}` : ""}
        </p>
        <p id={descId}>
          This loads a client extension into mission control. It runs with the
          same access as the rest of the app.
        </p>
        <p className="UplinkConsent__limit">
          The running mod vouches for this client, but a compromised mod could
          vouch for a compromised client — mod trust comes from CKAN, not from
          us. Load only Uplinks you installed on purpose.
        </p>
        <div className="UplinkConsent__actions">
          <GhostButton type="button" onClick={() => onResolve(false)}>
            Don’t load
          </GhostButton>
          <PrimaryButton
            ref={loadRef}
            type="button"
            onClick={() => onResolve(true)}
          >
            Load
          </PrimaryButton>
        </div>
      </Dialog>
    </Backdrop>
  );
}

/**
 * Mount the consent modal, resolve on the operator's click (or Escape =
 * decline), and tear the one-off root down. Returns the operator's decision.
 * `theme` is the app's active styled-components theme so the modal renders in
 * the same palette as the app it is about to extend.
 */
export function promptForConsent(
  info: ConsentInfo,
  theme: DefaultTheme,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const finish = (granted: boolean): void => {
      root.unmount();
      container.remove();
      resolve(granted);
    };

    root.render(
      <ThemeProvider theme={theme}>
        <ConsentDialog info={info} onResolve={finish} />
      </ThemeProvider>,
    );
  });
}
