import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import {
  useStationIdentityService,
  useStationName,
} from "./StationIdentityContext";

/*
 * The four font-size ternaries in this file stay literal, as one unit.
 *
 * NameSpan and NameInput are the display and edit states of the SAME chip and
 * share font-size, padding, radius and a 1px border; migrating one and not the
 * other changes the chip's width the instant the operator clicks to rename,
 * and a `${...}` interpolation is invisible to a CSS token pass, so a partial
 * sweep is the likely outcome rather than a hypothetical one.
 *
 * Pricing the swap: Label's 9px would take --font-size-2xs (+1px), which is
 * 11px under `@media (pointer: coarse)`, i.e. 2px of growth on a Steam Deck.
 * This chip renders inside StationScreen's position: fixed StationNameChip,
 * which has a logged incident of intercepting clicks on the widgets beneath
 * it. Growing it is not free.
 *
 * The same measurement holds the chip's inset off --inset-control. NameSpan
 * and NameInput ARE the pressable class the name describes, but the control
 * inset would add 8px of height and 12px of width to a fixed overlay that has
 * already been logged swallowing clicks meant for the dashboard underneath.
 * They take --inset-control-compact instead, which is the same class at a
 * floor this box can hold: 2px off the height and 4px off the width rather
 * than 8 and 12 on. That direction is the safe one for this overlay, so the
 * two states move together now instead of waiting for it to be re-measured.
 */
const Wrap = styled.div<{ $compact: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: var(--gap-related);
  font-size: ${({ $compact }) => ($compact ? "11px" : "14px")};
  color: var(--color-text-primary);
`;

const Label = styled.span<{ $compact: boolean }>`
  font-size: ${({ $compact }) => ($compact ? "9px" : "11px")};
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;

const NameSpan = styled.button<{ $compact: boolean }>`
  background: none;
  border: 1px dashed transparent;
  border-radius: var(--radius-sm);
  padding: var(--inset-control-compact);
  font-size: ${({ $compact }) => ($compact ? "11px" : "14px")};
  color: var(--color-status-info-fg);
  cursor: text;
  letter-spacing: 0.05em;

  &:hover {
    border-color: var(--color-border-strong);
    color: var(--color-status-go-fg);
  }
`;

const NameInput = styled.input<{ $compact: boolean }>`
  background: var(--color-surface-raised);
  border: 1px solid var(--color-text-faint);
  border-radius: var(--radius-sm);
  padding: var(--inset-control-compact);
  color: var(--color-status-info-fg);
  font-size: ${({ $compact }) => ($compact ? "11px" : "14px")};
  letter-spacing: 0.05em;
  outline: none;

  &:focus {
    border-color: var(--color-status-info-fg);
  }
`;

/**
 * Editable station-name chip. Click to edit; Enter or blur commits; Escape
 * reverts. Used both on the connect screen (compact=false) and the post-
 * connect fixed chip (compact=true).
 */
export function StationNameEditor({ compact = false }: { compact?: boolean }) {
  const service = useStationIdentityService();
  const name = useStationName();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      setDraft(name);
      inputRef.current?.select();
    }
  }, [editing, name]);

  const commit = () => {
    service.setName(draft);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(name);
    setEditing(false);
  };

  return (
    <Wrap $compact={compact}>
      <Label $compact={compact}>Station</Label>
      {editing ? (
        <NameInput
          ref={inputRef}
          $compact={compact}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") cancel();
          }}
          autoFocus
          maxLength={32}
        />
      ) : (
        <NameSpan
          $compact={compact}
          onClick={() => setEditing(true)}
          title="Click to rename"
        >
          {name}
        </NameSpan>
      )}
    </Wrap>
  );
}
