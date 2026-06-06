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

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Trap focus inside dialog
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
    first?.focus();
    return () => document.removeEventListener("keydown", handleTab);
  }, []);

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
            if (downOnBackdropRef.current && e.target === e.currentTarget) {
              onClose();
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
              <CloseButton onClick={onClose} aria-label="Close">
                <CloseIcon size={16} />
              </CloseButton>
            </DialogHeader>
            <DialogBody>{entry.content}</DialogBody>
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
