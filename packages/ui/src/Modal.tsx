import { safeRandomUuid } from "@gonogo/core";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";
import { GhostButton, PrimaryButton } from "./Button";
import { configEqual } from "./configEqual";
import { CloseIcon } from "./Icons";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModalEntry {
  id: string;
  title?: string;
  width?: string;
  content: ReactNode;
}

interface ModalOpenOptions {
  title?: string;
  /** CSS length for the dialog max-width. Defaults to 560px. */
  width?: string;
}

interface ModalContextValue {
  open: (content: ReactNode, options?: ModalOpenOptions) => string;
  close: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ModalContext = createContext<ModalContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ModalProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [modals, setModals] = useState<ModalEntry[]>([]);

  const open = useCallback(
    (content: ReactNode, options?: ModalOpenOptions): string => {
      const id = safeRandomUuid();
      setModals((prev) => [
        ...prev,
        { id, title: options?.title, width: options?.width, content },
      ]);
      return id;
    },
    [],
  );

  const close = useCallback((id: string) => {
    setModals((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const value = useMemo(() => ({ open, close }), [open, close]);

  return (
    <ModalContext.Provider value={value}>
      {children}
      {modals.map((m) => (
        <ModalDialog key={m.id} entry={m} onClose={() => close(m.id)} />
      ))}
    </ModalContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useModal(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModal must be used inside <ModalProvider>");
  return ctx;
}

// ---------------------------------------------------------------------------
// Chrome context — lets content rendered *inside* a modal register a sticky
// footer (rendered outside the scrollable body) and a dirty flag that gates
// every close path. This is the mechanism behind useModalSaveBar.
// ---------------------------------------------------------------------------

interface ModalChromeValue {
  /** Register/replace the sticky footer node. Pass null to clear. */
  setFooter: (node: ReactNode) => void;
  /** Register whether the current content has unsaved changes. */
  setDirty: (dirty: boolean) => void;
}

const ModalChromeContext = createContext<ModalChromeValue | null>(null);

/**
 * Render a sticky action footer for the enclosing modal and report unsaved
 * changes so the modal can guard its close paths. The footer lives OUTSIDE the
 * scrollable body, so it never scrolls out of view.
 *
 * Returns the rendered footer node (already portalled by the modal) — call
 * sites render nothing inline; they just call this hook with their footer JSX.
 */
export function useModalChrome(footer: ReactNode, dirty: boolean): void {
  const ctx = useContext(ModalChromeContext);
  const setFooter = ctx?.setFooter;
  const setDirty = ctx?.setDirty;

  useEffect(() => {
    setFooter?.(footer);
    return () => setFooter?.(null);
  }, [setFooter, footer]);

  useEffect(() => {
    setDirty?.(dirty);
    return () => setDirty?.(false);
  }, [setDirty, dirty]);
}

interface ModalSaveBarOptions<TValue> {
  /** Fired when the user confirms the save. Typically the config's handleSave. */
  onSave: () => void;
  /**
   * The working draft the form would persist on Save — the fully materialized
   * config object. Compared against both the value at open time (the baseline)
   * and the persisted `saved` config to derive the dirty flag.
   */
  value: TValue;
  /**
   * The currently-persisted config (the `config` prop). Used so an async data
   * shift that reconverges the draft to a saved value reads as clean, even if
   * it briefly diverged from the open-time baseline.
   */
  saved: TValue;
  /** Save button label. Defaults to "Save". */
  saveLabel?: ReactNode;
  /** Optional extra buttons rendered to the left of Save (e.g. Cancel). */
  extra?: ReactNode;
  /**
   * Disable the Save button. A form can be clean (nothing to discard) yet still
   * let the user re-save, so Save is NOT auto-disabled when clean.
   */
  disabled?: boolean;
}

/**
 * Drop-in replacement for an inline `<PrimaryButton onClick={handleSave}>Save`
 * at the bottom of a config form. Renders the Save button into the modal's
 * sticky footer (so it's always visible) and computes a dirty flag so the modal
 * asks before discarding unsaved edits.
 *
 * Dirty is true only when the draft differs from BOTH the value captured when
 * the modal opened (the baseline) AND the persisted config. The baseline guards
 * against false positives from sparse stored configs (a default that the form
 * materializes into a denser object would otherwise always read as dirty); the
 * persisted-config comparison lets an async data load that reconverges the
 * draft to a saved value settle back to clean.
 *
 * Renders nothing where it's called. If used outside a ModalProvider chrome
 * (e.g. an isolated unit test), it's a no-op — callers should not rely on a
 * fallback inline button.
 */
export function useModalSaveBar<TValue>(
  options: Readonly<ModalSaveBarOptions<TValue>>,
): void {
  const { onSave, value, saved, saveLabel = "Save", extra, disabled } = options;

  // Capture the draft as it stood when the modal opened. Wrapped in an object
  // so a falsy/empty first value still counts as "captured".
  const baselineRef = useRef<{ v: TValue } | null>(null);
  if (baselineRef.current === null) baselineRef.current = { v: value };

  const dirty =
    !configEqual(value, baselineRef.current.v) && !configEqual(value, saved);

  const footer = useMemo(
    () => (
      <>
        {extra}
        <PrimaryButton type="button" onClick={onSave} disabled={disabled}>
          {saveLabel}
        </PrimaryButton>
      </>
    ),
    [extra, onSave, disabled, saveLabel],
  );
  useModalChrome(footer, dirty);
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

interface ModalDialogProps {
  entry: ModalEntry;
  onClose: () => void;
}

function ModalDialog({ entry, onClose }: Readonly<ModalDialogProps>) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Only dismiss when both the press and the release land on the backdrop
  // itself. A mousedown inside the dialog (e.g. starting a text selection) that
  // releases over the backdrop must NOT close the modal.
  const downOnBackdropRef = useRef(false);

  // Footer + dirty state registered by content via useModalChrome.
  const [footer, setFooter] = useState<ReactNode>(null);
  const [dirty, setDirty] = useState(false);
  // Whether the discard-confirmation step is showing.
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Keep the latest dirty flag readable from event handlers without re-binding.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const confirmingRef = useRef(confirming);
  confirmingRef.current = confirming;

  const chrome = useMemo<ModalChromeValue>(() => ({ setFooter, setDirty }), []);

  // Single funnel for every close path. When the content reports unsaved
  // changes, intercept and show the discard confirmation instead of closing.
  const requestClose = useCallback(() => {
    if (dirtyRef.current) {
      setConfirming(true);
      return;
    }
    onClose();
  }, [onClose]);

  // Close on Escape. While the discard confirmation is open, Escape cancels
  // the confirmation (back to editing) rather than closing the modal.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (confirmingRef.current) {
        e.stopPropagation();
        setConfirming(false);
        return;
      }
      requestClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [requestClose]);

  // Move focus into the confirmation when it appears so it's immediately
  // keyboard-operable (and the focus trap stays inside the dialog).
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  // Trap focus inside dialog. Re-runs when the visible region swaps between the
  // form view and the confirmation view so the trap covers whatever is shown.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `confirming` and `footer` are intentional triggers — they change the set of focusable elements.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    function handleTab(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", handleTab);
    if (!confirming) first?.focus();
    return () => document.removeEventListener("keydown", handleTab);
  }, [confirming, footer]);

  return (
    <>
      {createPortal(
        // Backdrop is interactive (click-to-close) so it can't also declare
        // role="presentation" — the two contradict. Keyboard users close via
        // the dialog's Escape handler instead of clicking the backdrop.
        <Backdrop
          onMouseDown={(e) => {
            downOnBackdropRef.current = e.target === e.currentTarget;
          }}
          onMouseUp={(e) => {
            // Run the existing press+release-on-backdrop detection first, then
            // route through requestClose so the dirty guard can intercept.
            if (downOnBackdropRef.current && e.target === e.currentTarget) {
              requestClose();
            }
            downOnBackdropRef.current = false;
          }}
        >
          <Dialog
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={entry.title ? titleId : undefined}
            $width={entry.width}
          >
            <DialogHeader>
              {entry.title && (
                <DialogTitle id={titleId}>{entry.title}</DialogTitle>
              )}
              <CloseButton onClick={requestClose} aria-label="Close">
                <CloseIcon size={16} />
              </CloseButton>
            </DialogHeader>
            <DialogBody>
              <ModalChromeContext.Provider value={chrome}>
                {entry.content}
              </ModalChromeContext.Provider>
            </DialogBody>
            {footer && !confirming && <DialogFooter>{footer}</DialogFooter>}
            {confirming && (
              <DialogFooter
                role="alertdialog"
                aria-label="Discard unsaved changes?"
              >
                <DiscardPrompt>Discard unsaved changes?</DiscardPrompt>
                <GhostButton type="button" onClick={() => setConfirming(false)}>
                  Keep editing
                </GhostButton>
                <PrimaryButton
                  ref={confirmRef}
                  type="button"
                  onClick={() => {
                    setConfirming(false);
                    onClose();
                  }}
                >
                  Discard
                </PrimaryButton>
              </DialogFooter>
            )}
          </Dialog>
        </Backdrop>,
        document.body,
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`;

const Dialog = styled.div<{ $width?: string }>`
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-strong);
  border-radius: 6px;
  min-width: min(320px, 100vw - 16px);
  max-width: ${({ $width }) => $width ?? "560px"};
  width: 90vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
`;

const DialogHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
`;

const DialogTitle = styled.h2`
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-muted);
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  color: var(--color-text-faint);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 2px 4px;

  @media (hover: hover) {
    &:hover {
      color: var(--color-text-primary);
    }
  }
  @media (pointer: coarse) {
    min-width: 44px;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
`;

const DialogBody = styled.div`
  padding: 16px;
  overflow-y: auto;
  /* iOS Safari momentum scrolling inside the dialog. */
  -webkit-overflow-scrolling: touch;
  flex: 1;
`;

/* Sticky action region. Lives outside DialogBody so it never scrolls away. */
const DialogFooter = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
`;

const DiscardPrompt = styled.span`
  margin-right: auto;
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
`;
