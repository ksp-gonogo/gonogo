import { TELEMACHUS_META } from "@ksp-gonogo/data";
import {
  type ChangeEvent,
  forwardRef,
  type KeyboardEvent,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import styled from "styled-components";

interface KeyOption {
  key: string;
  label: string;
  group: string;
  unit?: string;
}

export interface TagAutocompleteProps {
  value: string;
  onChange: (next: string) => void;
  onKeyDown?: (
    e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>,
  ) => void;
  multiline?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  onBlur?: () => void;
}

/**
 * Text input that opens a key-picker popover when the user types `{{`,
 * filtered against `TELEMACHUS_META`'s friendly labels/groups (the stream-
 * mapped key catalog — see `useKeyOptions` below). Selection inserts
 * `{{<key>}}` and moves the cursor past the closer.
 *
 * Supports both single-line and multi-line via the `multiline` prop —
 * Notes uses single-line for the add-row and multi-line for the
 * in-place edit textarea.
 */
export const TagAutocomplete = forwardRef<
  HTMLInputElement | HTMLTextAreaElement,
  TagAutocompleteProps
>(function TagAutocomplete(
  {
    value,
    onChange,
    onKeyDown,
    multiline = false,
    placeholder,
    ariaLabel,
    autoFocus,
    onBlur,
  },
  forwardedRef,
) {
  const localRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  useImperativeHandle(forwardedRef, () => localRef.current as never, []);

  const options = useKeyOptions();
  const [openAt, setOpenAt] = useState<{
    start: number;
    partial: string;
  } | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const filtered = useMemo(() => {
    if (openAt === null) return options;
    const q = openAt.partial.toLowerCase();
    if (q === "") return options.slice(0, 50);
    const matches = options.filter(
      (o) =>
        o.key.toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
    );
    return matches.slice(0, 50);
  }, [options, openAt]);

  // Clamp the selection cursor whenever the filtered list shrinks below
  // it — otherwise Enter inserts the wrong option (or undefined when the
  // index points past the end of the array).
  useEffect(() => {
    setSelectedIdx((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Detect whether the cursor is inside an open `{{ ... }}` tag and, if so,
  // extract the partial key the user has typed since `{{`.
  const evaluateCursor = () => {
    const el = localRef.current;
    if (!el) {
      setOpenAt(null);
      return;
    }
    const pos = el.selectionStart ?? 0;
    const upto = value.slice(0, pos);
    const openIdx = upto.lastIndexOf("{{");
    if (openIdx === -1) {
      setOpenAt(null);
      return;
    }
    // If there's a closing `}}` between the open and the cursor, we're
    // outside the tag.
    const closeIdx = upto.indexOf("}}", openIdx);
    if (closeIdx !== -1 && closeIdx < pos) {
      setOpenAt(null);
      return;
    }
    const partial = upto.slice(openIdx + 2);
    // Bail if the partial spans a whitespace — likely natural text "{{ foo"
    // with a space inside is fine, but a newline isn't.
    if (/\n/.test(partial)) {
      setOpenAt(null);
      return;
    }
    setOpenAt({ start: openIdx, partial });
  };

  const handleChange = (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    onChange(e.target.value);
    // After React applies the value, the cursor position is at the typed
    // character — schedule a microtask to evaluate so selectionStart is
    // current.
    queueMicrotask(evaluateCursor);
  };

  const insertSelection = (opt: KeyOption) => {
    const el = localRef.current;
    if (!el || openAt === null) return;
    const pos = el.selectionStart ?? value.length;
    const before = value.slice(0, openAt.start);
    const after = value.slice(pos);
    const insertion = `{{${opt.key}}}`;
    const next = before + insertion + after;
    onChange(next);
    setOpenAt(null);
    // Restore cursor just after the inserted `}}`.
    const nextCursor = (before + insertion).length;
    requestAnimationFrame(() => {
      const node = localRef.current;
      if (node) {
        node.focus();
        node.setSelectionRange(nextCursor, nextCursor);
      }
    });
  };

  const handleKeyDown = (
    e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (openAt !== null) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        if (filtered.length > 0) {
          e.preventDefault();
          insertSelection(filtered[selectedIdx] ?? filtered[0]);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setOpenAt(null);
        return;
      }
    }
    onKeyDown?.(e);
  };

  const InputEl = (
    multiline ? StyledTextarea : StyledInput
  ) as React.ElementType;

  return (
    <Wrap>
      <InputEl
        ref={localRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onKeyUp={evaluateCursor}
        onClick={evaluateCursor}
        onSelect={evaluateCursor}
        onBlur={() => {
          // Delay so a click on a popover item still fires.
          setTimeout(() => {
            setOpenAt(null);
            onBlur?.();
          }, 120);
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
      />
      {openAt !== null && filtered.length > 0 && (
        <Popover role="listbox" aria-label="Variable suggestions">
          {filtered.map((opt, i) => (
            <PopoverItem
              key={opt.key}
              type="button"
              role="option"
              $selected={i === selectedIdx}
              aria-selected={i === selectedIdx}
              onMouseDown={(e) => {
                // mousedown rather than click so the input's blur handler
                // (which clears openAt) doesn't fire first.
                e.preventDefault();
                insertSelection(opt);
              }}
              onMouseEnter={() => setSelectedIdx(i)}
            >
              <OptLabel>{opt.label}</OptLabel>
              <OptKey>{opt.key}</OptKey>
              <OptGroup>{opt.group}</OptGroup>
            </PopoverItem>
          ))}
        </Popover>
      )}
    </Wrap>
  );
});

function useKeyOptions(): KeyOption[] {
  // The legacy "data" `DataSource` (and its live schema listing) is gone —
  // suggestions now come straight from `TELEMACHUS_META`, which already
  // covers every stream-mapped key (see `map-topic.ts`'s
  // `TELEMACHUS_CLEAN_HOMES`). Recomputed every render — the map is small
  // (~few dozen entries) and the cost is well under a millisecond.
  return useMemo<KeyOption[]>(() => {
    const merged: KeyOption[] = Object.entries(TELEMACHUS_META).map(
      ([k, meta]) => ({
        key: k,
        label: meta.label,
        group: meta.group ?? "Other",
        unit: meta.unit === "raw" ? undefined : meta.unit,
      }),
    );
    return merged.sort((a, b) => {
      if (a.group !== b.group) return a.group.localeCompare(b.group);
      return a.label.localeCompare(b.label);
    });
  }, []);
}

// ── Styles ──────────────────────────────────────────────────────────────

const Wrap = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
`;

const inputStyles = `
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-primary);
  font: inherit;
  padding: 4px 6px;
  border-radius: 2px;
  width: 100%;
  box-sizing: border-box;
  outline: none;

  &:focus {
    border-color: var(--color-accent-fg);
  }
`;

const StyledInput = styled.input`
  ${inputStyles}
`;

const StyledTextarea = styled.textarea`
  ${inputStyles}
  min-height: 1.4em;
  resize: vertical;
`;

const Popover = styled.div`
  position: absolute;
  left: 0;
  top: calc(100% + 4px);
  z-index: 200;
  background: var(--color-surface-overlay, rgba(20, 22, 26, 0.96));
  border: 1px solid var(--color-border-strong);
  border-radius: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  max-height: 240px;
  width: max(280px, 100%);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
`;

const PopoverItem = styled.button<{ $selected: boolean }>`
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: 1px 12px;
  padding: 6px 10px;
  background: ${(p) =>
    p.$selected ? "var(--color-surface-raised)" : "transparent"};
  border: none;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
  color: var(--color-text-primary);

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: -2px;
  }
`;

const OptLabel = styled.span`
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-primary);
`;

const OptKey = styled.span`
  font-size: 10px;
  font-family: monospace;
  color: var(--color-text-faint);
  align-self: end;
`;

const OptGroup = styled.span`
  font-size: 10px;
  color: var(--color-accent-fg);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  grid-column: 1 / -1;
`;
