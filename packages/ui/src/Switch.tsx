import styled from "styled-components";

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
}) {
  return (
    <SwitchLabel>
      <SwitchInput
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <SwitchTrack $checked={checked}>
        <SwitchThumb $checked={checked} />
      </SwitchTrack>
      {label && <SwitchText>{label}</SwitchText>}
    </SwitchLabel>
  );
}

const SwitchLabel = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;

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

const SwitchTrack = styled.div<{ $checked: boolean }>`
  width: 28px;
  height: 14px;
  border-radius: 7px;
  background: ${({ $checked }) => ($checked ? "var(--color-status-go-bg)" : "var(--color-surface-raised)")};
  border: 1px solid ${({ $checked }) => ($checked ? "var(--color-status-go-bg)" : "var(--color-border-strong)")};
  position: relative;
  flex-shrink: 0;
  transition: background 0.15s, border-color 0.15s;
`;

const SwitchThumb = styled.div<{ $checked: boolean }>`
  position: absolute;
  top: 3px;
  left: ${({ $checked }) => ($checked ? "16px" : "3px")};
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ $checked }) => ($checked ? "var(--color-accent-fg)" : "var(--color-text-faint)")};
  transition: left 0.15s, background 0.15s;
`;

const SwitchText = styled.span`
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;
