import styled from "styled-components";

interface SwitchBaseProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  /** Renders dimmed and non-interactive; `onChange` never fires. For a toggle whose effective state is controlled elsewhere (e.g. a sub-setting inert while its parent setting is off). */
  disabled?: boolean;
  /** The checkbox's id, for a `<label htmlFor>` outside the switch. */
  id?: string;
}

/**
 * A switch always has a name: a visible `label` drawn beside it, or an
 * `aria-label` where the row it sits in shows its own label text.
 */
export type SwitchProps = SwitchBaseProps &
  (
    | { label: string; "aria-label"?: never }
    | { label?: never; "aria-label": string }
  );

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  id,
  "aria-label": ariaLabel,
}: SwitchProps) {
  return (
    <SwitchLabel $disabled={disabled}>
      <SwitchInput
        type="checkbox"
        id={id}
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
  gap: var(--gap-glyph-control);
  cursor: ${({ $disabled }) => ($disabled ? "not-allowed" : "pointer")};
  user-select: none;
  opacity: ${({ $disabled }) => ($disabled ? 0.5 : 1)};

  @media (pointer: coarse) {
    /* Expand tap target to 44px tall without enlarging the visual track. */
    min-height: 44px;
    padding: var(--inset-switch-touch);
  }
`;

const SwitchTrack = styled.div<{ $checked: boolean; $disabled?: boolean }>`
  width: 28px;
  height: 14px;
  /* --radius-pill keeps the stadium shape through a height change. */
  border-radius: var(--radius-pill);
  background: ${({ $checked, $disabled }) => ($disabled ? "var(--color-surface-raised)" : $checked ? "var(--color-status-go-mark)" : "var(--color-surface-raised)")};
  border: 1px solid ${({ $checked, $disabled }) => ($disabled ? "var(--color-border-strong)" : $checked ? "var(--color-status-go-mark)" : "var(--color-border-strong)")};
  position: relative;
  flex-shrink: 0;
  transition: background var(--duration-base), border-color var(--duration-base);
`;

/* The input is invisible and sizeless, so its keyboard focus is drawn on the
   track it sits beside. */
const SwitchInput = styled.input`
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;

  &:focus-visible + ${SwitchTrack} {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;

const SwitchThumb = styled.div<{ $checked: boolean; $disabled?: boolean }>`
  position: absolute;
  /* Measured inside the border: the track is border-box, so its 1px border leaves a 26 by 12 box, and 2px on every side centres the 8px thumb at either end. */
  top: 2px;
  left: ${({ $checked }) => ($checked ? "16px" : "2px")};
  width: 8px;
  height: 8px;
  border-radius: var(--radius-circle);
  background: ${({ $checked, $disabled }) => ($disabled ? "var(--color-text-faint)" : $checked ? "var(--color-accent-fg)" : "var(--color-text-faint)")};
  transition: left var(--duration-base), background var(--duration-base);
`;

const SwitchText = styled.span`
  font-size: var(--font-size-caption);
  color: var(--color-text-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;
