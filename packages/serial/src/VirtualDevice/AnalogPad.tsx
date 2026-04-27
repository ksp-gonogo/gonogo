import { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";

interface Props {
  label: string;
  onChange: (value: number) => void;
  onRelease?: () => void;
}

/**
 * 1-D horizontal spring-loaded slider. Emits normalised -1..1 values on
 * drag and snaps back to centre on release, so analog inputs auto-zero
 * when unheld.
 *
 * The thumb position has no external authority — it only exists while
 * the user is dragging — so the component owns it in local state. An
 * earlier version took a `value` prop that was hardcoded by the parent
 * and never updated, which left the thumb visually pinned at centre
 * while the drag events quietly fired underneath.
 */
export function AnalogPad({ label, onChange, onRelease }: Readonly<Props>) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pos, setPos] = useState(0);

  const updateFromPointer = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const raw = (clientX - rect.left) / rect.width;
      const clamped = Math.max(0, Math.min(1, raw));
      const normalised = clamped * 2 - 1;
      setPos(normalised);
      onChange(normalised);
    },
    [onChange],
  );

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: PointerEvent) => {
      updateFromPointer(e.clientX);
    };
    const handleUp = () => {
      setDragging(false);
      setPos(0);
      onRelease?.();
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [dragging, updateFromPointer, onRelease]);

  const thumbLeft = `${((pos + 1) / 2) * 100}%`;

  return (
    <Wrap>
      <Label>{label}</Label>
      <Track
        ref={trackRef}
        onPointerDown={(e) => {
          setDragging(true);
          updateFromPointer(e.clientX);
        }}
      >
        <Centre />
        <Thumb style={{ left: thumbLeft }} $active={dragging} />
      </Track>
      <Value>{pos.toFixed(2)}</Value>
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Label = styled.span`
  font-size: var(--font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-dim);
`;

const Track = styled.div`
  position: relative;
  height: 24px;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: 4px;
  cursor: pointer;
  touch-action: none;
`;

const Centre = styled.div`
  position: absolute;
  left: 50%;
  top: 4px;
  bottom: 4px;
  width: 1px;
  background: var(--color-border-subtle);
`;

const Thumb = styled.div<{ $active: boolean }>`
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: ${({ $active }) => ($active ? "var(--color-accent-fg)" : "var(--color-status-info-fg)")};
  box-shadow: 0 0 6px
    ${({ $active }) =>
      $active ? "rgba(0,255,136,0.5)" : "rgba(124,204,255,0.4)"};
  pointer-events: none;
`;

const Value = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
  text-align: right;
`;
