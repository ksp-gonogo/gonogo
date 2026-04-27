import { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import {
  useStationIdentityService,
  useStationName,
} from "./StationIdentityContext";

const Wrap = styled.div<{ $compact: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
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
  border-radius: 3px;
  padding: 2px 6px;
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
  border-radius: 3px;
  padding: 2px 6px;
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
