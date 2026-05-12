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
  gap: 10px;
  flex-wrap: wrap;
`;

const FileInputButton = styled.label<{ $disabled: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: 3px;
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  letter-spacing: 0.04em;
  padding: 6px 12px;
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
    padding: 10px 14px;
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
