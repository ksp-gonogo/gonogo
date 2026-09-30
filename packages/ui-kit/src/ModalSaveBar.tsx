import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { Button } from "./Button";
import { configEqual } from "./configEqual";

/**
 * What a modal dialog offers the content inside it: a sticky footer and an
 * unsaved-changes flag. Read it through {@link useModalChrome} or
 * {@link useModalSaveBar} rather than directly.
 *
 * @category Modal
 */
export interface ModalChromeValue {
  /** Sets or replaces the sticky footer node. Pass null to clear it. */
  setFooter: (node: ReactNode) => void;
  /** Reports whether the current content has unsaved changes. */
  setDirty: (dirty: boolean) => void;
}

/**
 * The context each open modal dialog provides to its content, `null` outside
 * a modal. Content uses {@link useModalChrome} or {@link useModalSaveBar}
 * rather than reading it.
 *
 * @category Modal
 */
export const ModalChromeContext = createContext<ModalChromeValue | null>(null);

/**
 * Shows `footer` as the enclosing modal's sticky footer, below the scrolling
 * body so it never scrolls out of view, and reports `dirty` so the modal asks
 * before discarding unsaved changes. The footer is cleared and the flag reset
 * on unmount. Does nothing outside a modal. For a plain Save button use
 * {@link useModalSaveBar}, which works out `dirty` for you.
 *
 * @category Modal
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

/**
 * Options for {@link useModalSaveBar}.
 *
 * @category Modal
 */
export interface ModalSaveBarOptions<Draft> {
  /** Called when the operator presses Save. */
  onSave: () => void;
  /**
   * The working draft the form would persist on Save, as the full config
   * object. Compared with its value when the modal opened and with `saved` to
   * decide whether there are unsaved changes.
   */
  value: Draft;
  /**
   * The config as currently persisted (the form's `config` prop). A draft
   * equal to it counts as clean even when it differs from the value at open.
   */
  saved: Draft;
  /** Save button label. Defaults to "Save". */
  saveLabel?: ReactNode;
  /** Extra buttons drawn to the left of Save, such as Cancel. */
  extra?: ReactNode;
  /**
   * Disables the Save button. Save is not disabled automatically when the form
   * has no changes, so the operator can always save again.
   */
  disabled?: boolean;
}

/**
 * Puts a primary Save button (and any `extra` buttons) in the enclosing
 * modal's sticky footer, and marks the modal dirty so it asks before
 * discarding unsaved edits. Use it in a widget's config form in place of a
 * Save button at the bottom of the form.
 *
 * The form counts as dirty only when `value` differs, by {@link configEqual},
 * from both its value when the modal opened and `saved`. The hook renders
 * nothing where it is called and does nothing outside a modal.
 *
 * @example
 * ```tsx
 * function NavballConfigForm({ config, onSave }: ConfigComponentProps<NavballConfig>) {
 *   const [controlMode, setControlMode] = useState(config?.controlMode === true);
 *   const candidate = useMemo(() => ({ controlMode }), [controlMode]);
 *   useModalSaveBar({
 *     onSave: () => onSave(candidate),
 *     value: candidate,
 *     saved: config ?? {},
 *   });
 *   return <ConfigForm>...</ConfigForm>;
 * }
 * ```
 *
 * @category Modal
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
        <Button
          variant="primary"
          type="button"
          onClick={onSave}
          disabled={disabled}
        >
          {saveLabel}
        </Button>
      </>
    ),
    [extra, onSave, disabled, saveLabel],
  );
  useModalChrome(footer, dirty);
}
