import {
  type ChangeEvent,
  forwardRef,
  type ReactNode,
  useId,
  useRef,
} from "react";
import styled from "styled-components";

export interface FileInputProps {
  id?: string;
  /** Visible button label. Defaults to "Choose file". */
  label?: ReactNode;
  /** MIME pattern, e.g. "image/*". */
  accept?: string;
  /** When set, allows selecting more than one file. */
  multiple?: boolean;
  /** Filename(s) to display alongside the button. */
  fileName?: string | null;
  /** Placeholder shown when no file is selected. */
  emptyText?: string;
  disabled?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

/**
 * Native `<input type="file">` styled to match the dark theme. The OS-painted
 * "No file chosen" + filename text is unstyleable on most browsers and renders
 * black-on-dark, so we visually hide the input and surface the filename in
 * theme-aware text instead.
 */
export const FileInput = forwardRef<HTMLInputElement, FileInputProps>(
  function FileInput(
    {
      id,
      label = "Choose file",
      accept,
      multiple,
      fileName,
      emptyText = "No file chosen",
      disabled,
      onChange,
    },
    ref,
  ) {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const internalRef = useRef<HTMLInputElement | null>(null);

    return (
      <FileInputRow>
        <FileInputHidden
          id={inputId}
          ref={(node) => {
            internalRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
          }}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={onChange}
        />
        <FileInputButton htmlFor={inputId} $disabled={!!disabled}>
          {label}
        </FileInputButton>
        <FileInputName aria-live="polite" $hasFile={!!fileName}>
          {fileName ?? emptyText}
        </FileInputName>
      </FileInputRow>
    );
  },
);

const FileInputRow = styled.div`
  display: flex;
  align-items: center;
  /* 10 is the one rung with no gap name over it: --gap-related is 8 and
     --gap-section is 16. */
  gap: var(--space-10);
  flex-wrap: wrap;
`;

const FileInputButton = styled.label<{ $disabled: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  letter-spacing: 0.04em;
  /* The button inset, shared with ui-kit's Button. Wider than --inset-row and
     shorter than --inset-panel, so no --inset-* names it. */
  padding: var(--space-6) var(--space-12);
  cursor: ${({ $disabled }) => ($disabled ? "not-allowed" : "pointer")};
  opacity: ${({ $disabled }) => ($disabled ? 0.5 : 1)};
  user-select: none;

  &:hover {
    border-color: ${({ $disabled }) =>
      $disabled ? "var(--color-border-strong)" : "var(--color-accent-fg)"};
  }

  /* The hidden input owns focus; mirror its focus ring onto the button label. */
  input:focus-visible + & {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }

  @media (pointer: coarse) {
    min-height: 44px;
    /* One rung wider than the base inset (--space-12), same as ui-kit Button.
       A 14px value would snap onto the base rung and erase the horizontal
       widening this block exists for.

       It happens to equal --inset-panel, and is deliberately not written as
       one: this pair is a 44px touch target, so it must move when the touch
       guidance moves and must NOT move when the panel tier does. */
    padding: var(--space-10) var(--space-16);
  }
`;

const FileInputHidden = styled.input`
  /* Visually hidden but still keyboard-focusable. */
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
`;

const FileInputName = styled.span<{ $hasFile: boolean }>`
  font-size: var(--font-size-sm);
  color: ${({ $hasFile }) =>
    $hasFile ? "var(--color-text-primary)" : "var(--color-text-faint)"};
  word-break: break-all;
`;
