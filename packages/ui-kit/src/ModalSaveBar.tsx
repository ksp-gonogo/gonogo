import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { PrimaryButton } from "./Button";
import { configEqual } from "./configEqual";

/*
 * Chrome context: lets content rendered inside a modal register a sticky footer
 * (outside the scrollable body) and a dirty flag that gates every close path.
 * The modal provides it; `useModalChrome` and `useModalSaveBar` consume it.
 */

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
 * Call sites render nothing inline; they call this hook with their footer JSX.
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

export interface ModalSaveBarOptions<Draft> {
  /** Fired when the user confirms the save. Typically the config's handleSave. */
  onSave: () => void;
  /**
   * The working draft the form would persist on Save, the fully materialized
   * config object. Compared against both the value at open time (the baseline)
   * and the persisted `saved` config to derive the dirty flag.
   */
  value: Draft;
  /**
   * The currently-persisted config (the `config` prop). Used so an async data
   * shift that reconverges the draft to a saved value reads as clean, even if
   * it briefly diverged from the open-time baseline.
   */
  saved: Draft;
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
 * Dirty is true only when the draft differs from both the value captured when
 * the modal opened (the baseline) and the persisted config: the baseline stops
 * a sparse stored config reading as dirty, and the persisted comparison lets a
 * draft that reconverges settle back to clean.
 *
 * Renders nothing where it is called, and is a no-op outside a modal.
 */
export function useModalSaveBar<Draft>(
  options: Readonly<ModalSaveBarOptions<Draft>>,
): void {
  const { onSave, value, saved, saveLabel = "Save", extra, disabled } = options;

  // Wrapped in an object, so a falsy first value still counts as captured.
  const baselineRef = useRef<{ v: Draft } | null>(null);
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
