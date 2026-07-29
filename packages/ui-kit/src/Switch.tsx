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
  gap: var(--space-6, 6px);
  cursor: ${({ $disabled }) => ($disabled ? "not-allowed" : "pointer")};
  user-select: none;
  opacity: ${({ $disabled }) => ($disabled ? 0.5 : 1)};

  @media (pointer: coarse) {
    /* Expand tap target to 44px tall without enlarging the visual track. */
    min-height: 44px;
    padding: 0 var(--space-6, 6px);
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
  /* Stadium, not a corner: the old 7px was exactly half the 14px height.
     --radius-pill clamps to the same shape and survives a height change. */
  border-radius: var(--radius-pill, 999px);
  background: ${({ $checked, $disabled }) => ($disabled ? "var(--color-surface-raised)" : $checked ? "var(--color-status-go-bg)" : "var(--color-surface-raised)")};
  border: 1px solid ${({ $checked, $disabled }) => ($disabled ? "var(--color-border-strong)" : $checked ? "var(--color-status-go-bg)" : "var(--color-border-strong)")};
  position: relative;
  flex-shrink: 0;
  transition: background var(--duration-base, 150ms), border-color var(--duration-base, 150ms);
`;

const SwitchThumb = styled.div<{ $checked: boolean; $disabled?: boolean }>`
  position: absolute;
  /* Off the spacing ladder on purpose: 3px is (14 - 8) / 2, the centring
     offset for an 8px thumb in a 14px track, and the checked 16px is the
     travel that pairs with it. Snapping either to a rung decentres the thumb
     and desynchronises it from the JS ternary below. Recompute both if the
     track height or thumb size changes. */
  top: 3px;
  left: ${({ $checked }) => ($checked ? "16px" : "3px")};
  width: 8px;
  height: 8px;
  border-radius: var(--radius-circle, 50%);
  background: ${({ $checked, $disabled }) => ($disabled ? "var(--color-text-faint)" : $checked ? "var(--color-accent-fg)" : "var(--color-text-faint)")};
  transition: left var(--duration-base, 150ms), background var(--duration-base, 150ms);
`;

const SwitchText = styled.span`
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;
