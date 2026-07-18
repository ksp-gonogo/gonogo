import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { PrimaryButton } from "./Button";
import { configEqual } from "./configEqual";

// ---------------------------------------------------------------------------
// Chrome context — lets content rendered *inside* a modal register a sticky
// footer (rendered outside the scrollable body) and a dirty flag that gates
// every close path. This is the mechanism behind useModalSaveBar.
//
// The modal shell itself (`ModalProvider`/`ModalDialog`) stays in
// `@ksp-gonogo/ui` — it needs `safeRandomUuid` from `@ksp-gonogo/core`,
// which this package must never depend on. `ModalChromeContext` is the
// shared seam: `ui`'s `ModalDialog` provides it, this hook (and
// `useModalSaveBar`) consume it. Neither side needs to know about the
// other's extra dependencies.
// ---------------------------------------------------------------------------

export interface ModalChromeValue {
  /** Register/replace the sticky footer node. Pass null to clear. */
  setFooter: (node: ReactNode) => void;
  /** Register whether the current content has unsaved changes. */
  setDirty: (dirty: boolean) => void;
}

export const ModalChromeContext = createContext<ModalChromeValue | null>(null);

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

export interface ModalSaveBarOptions<TValue> {
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
