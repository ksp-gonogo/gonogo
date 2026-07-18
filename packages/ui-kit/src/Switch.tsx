import styled from "styled-components";

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  /** Renders dimmed and non-interactive; `onChange` never fires. For a toggle whose effective state is controlled elsewhere (e.g. a sub-setting inert while its parent setting is off). */
  disabled?: boolean;
  /** Accessible name for the underlying checkbox when no VISIBLE `label` is rendered here (e.g. a settings row that shows its own label text alongside the switch, not inside it). */
  "aria-label"?: string;
}) {
  return (
    <SwitchLabel $disabled={disabled}>
      <SwitchInput
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label ? undefined : ariaLabel}
      />
      <SwitchTrack $checked={checked} $disabled={disabled}>
        <SwitchThumb $checked={checked} $disabled={disabled} />
      </SwitchTrack>
      {label && <SwitchText>{label}</SwitchText>}
    </SwitchLabel>
  );
}

const SwitchLabel = styled.label<{ $disabled?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: ${({ $disabled }) => ($disabled ? "not-allowed" : "pointer")};
  user-select: none;
  opacity: ${({ $disabled }) => ($disabled ? 0.5 : 1)};

  @media (pointer: coarse) {
    /* Expand tap target to 44px tall without enlarging the visual track. */
    min-height: 44px;
    padding: 0 6px;
  }
`;

const SwitchInput = styled.input`
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
`;

const SwitchTrack = styled.div<{ $checked: boolean; $disabled?: boolean }>`
  width: 28px;
  height: 14px;
  border-radius: 7px;
  background: ${({ $checked, $disabled }) => ($disabled ? "var(--color-surface-raised)" : $checked ? "var(--color-status-go-bg)" : "var(--color-surface-raised)")};
  border: 1px solid ${({ $checked, $disabled }) => ($disabled ? "var(--color-border-strong)" : $checked ? "var(--color-status-go-bg)" : "var(--color-border-strong)")};
  position: relative;
  flex-shrink: 0;
  transition: background 0.15s, border-color 0.15s;
`;

const SwitchThumb = styled.div<{ $checked: boolean; $disabled?: boolean }>`
  position: absolute;
  top: 3px;
  left: ${({ $checked }) => ($checked ? "16px" : "3px")};
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ $checked, $disabled }) => ($disabled ? "var(--color-text-faint)" : $checked ? "var(--color-accent-fg)" : "var(--color-text-faint)")};
  transition: left 0.15s, background 0.15s;
`;

const SwitchText = styled.span`
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;
