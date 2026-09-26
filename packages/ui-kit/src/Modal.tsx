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
import { CloseIcon } from "./Icons";
import { ModalChromeContext, type ModalChromeValue } from "./ModalSaveBar";
import { titleText } from "./titleText";

interface ModalEntry {
  id: string;
  title?: string;
  ariaLabel?: string;
  width?: string;
  content: ReactNode;
}

interface ModalOpenOptions {
  title?: string;
  /** Names a dialog that has no visible `title`. Ignored when `title` is given. */
  ariaLabel?: string;
  /** CSS length for the dialog max-width. Defaults to 560px. */
  width?: string;
}

interface ModalContextValue {
  open: (content: ReactNode, options?: ModalOpenOptions) => string;
  close: (id: string) => void;
}

const ModalContext = createContext<ModalContextValue | null>(null);

/**
 * The id `open()` hands back is an opaque close-handle: the only thing anyone
 * does with it is pass it to `close()`, which compares it to the ids of the
 * modals in this module's own stack, so a counter is sufficient.
 */
let modalSeq = 0;

export function ModalProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [modals, setModals] = useState<ModalEntry[]>([]);

  const open = useCallback(
    (content: ReactNode, options?: ModalOpenOptions): string => {
      const id = `modal-${++modalSeq}`;
      setModals((prev) => [
        ...prev,
        {
          id,
          title: options?.title,
          ariaLabel: options?.ariaLabel,
          width: options?.width,
          content,
        },
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
      {modals.map((m, i) => (
        <ModalDialog
          key={m.id}
          entry={m}
          isTop={i === modals.length - 1}
          onClose={() => close(m.id)}
        />
      ))}
    </ModalContext.Provider>
  );
}

export function useModal(): ModalContextValue {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModal must be used inside <ModalProvider>");
  return ctx;
}

interface ModalDialogProps {
  entry: ModalEntry;
  /** Only the topmost of a stack answers the keyboard. */
  isTop: boolean;
  onClose: () => void;
}

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function ModalDialog({ entry, isTop, onClose }: Readonly<ModalDialogProps>) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const isTopRef = useRef(isTop);
  isTopRef.current = isTop;

  // Focus goes back to whatever opened the dialog once it closes.
  useEffect(() => {
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);
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
      if (e.key !== "Escape" || !isTopRef.current) return;
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

  /*
   * Trap focus inside the dialog. The focusable set is read on every Tab, so a
   * control that renders late or becomes disabled is judged as it is now.
   * Re-runs when the form and confirmation views swap, to move focus into
   * whichever is shown.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `confirming` and `footer` are intentional triggers, they change the set of focusable elements.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    function handleTab(e: KeyboardEvent) {
      if (e.key !== "Tab" || !isTopRef.current || !el) return;
      const focusable = el.querySelectorAll<HTMLElement>(FOCUSABLE);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
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
    if (!confirming) el.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => document.removeEventListener("keydown", handleTab);
  }, [confirming, footer]);

  return (
    <>
      {createPortal(
        // Backdrop is interactive (click-to-close) so it can't also declare
        // role="presentation": the two contradict. Keyboard users close via
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
            aria-label={entry.title ? undefined : entry.ariaLabel}
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

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal);
`;

const Dialog = styled.div<{ $width?: string }>`
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-floating);
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
  padding: var(--inset-modal-bar);
  border-bottom: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
`;

const DialogTitle = styled.h2`
  margin: 0;
  ${titleText}
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  color: var(--color-text-faint);
  cursor: pointer;
  line-height: var(--line-height-flush);
  padding: var(--inset-glyph-button);

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
  padding: var(--inset-modal-body);
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
  gap: var(--gap-control-row);
  padding: var(--inset-modal-bar);
  border-top: 1px solid var(--color-border-subtle);
  flex-shrink: 0;
`;

const DiscardPrompt = styled.span`
  margin-right: auto;
  font-size: var(--font-size-compact);
  color: var(--color-text-primary);
`;
