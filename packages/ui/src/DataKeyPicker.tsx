import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import styled from "styled-components";

export interface KeyOption {
  key: string;
  label?: string;
  unit?: string;
  group?: string;
}

export interface DataKeyPickerProps {
  keys: KeyOption[];
  value: string | null;
  onChange: (key: string | null) => void;
  clearable?: boolean;
  placeholder?: string;
}

function matches(option: KeyOption, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const label = option.label ?? option.key;
  return (
    label.toLowerCase().includes(q) || option.key.toLowerCase().includes(q)
  );
}

export function DataKeyPicker({
  keys,
  value,
  onChange,
  clearable = false,
  placeholder = "Search…",
}: DataKeyPickerProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const listboxId = useId();
  const optionIdPrefix = useId();
  const optionId = (key: string) => `${optionIdPrefix}-${key}`;

  const selectedOption = keys.find((k) => k.key === value);

  const filtered = useMemo(
    () => keys.filter((k) => matches(k, query)),
    [keys, query],
  );

  const sortedGroups = useMemo(() => {
    const groups = new Map<string, KeyOption[]>();
    for (const k of filtered) {
      const g = k.group ?? "Other";
      let bucket = groups.get(g);
      if (!bucket) {
        bucket = [];
        groups.set(g, bucket);
      }
      bucket.push(k);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const flatOptions = useMemo(
    () => sortedGroups.flatMap(([, items]) => items),
    [sortedGroups],
  );

  const openPicker = useCallback(() => {
    setOpen(true);
    setQuery("");
    setActiveIndex(-1);
  }, []);

  const closePicker = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
  }, []);

  const selectOption = useCallback(
    (key: string) => {
      onChange(key);
      closePicker();
    },
    [onChange, closePicker],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "Enter" || e.key === "ArrowDown") openPicker();
      return;
    }
    if (e.key === "Escape") {
      closePicker();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatOptions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      // Arrow-highlighted item first; fall back to first filtered result so
      // "type a partial label + Enter" works without needing an arrow key.
      const opt = activeIndex >= 0 ? flatOptions[activeIndex] : flatOptions[0];
      if (opt) selectOption(opt.key);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) closePicker();
    };
    document.addEventListener("pointerdown", onOutside);
    return () => document.removeEventListener("pointerdown", onOutside);
  }, [open, closePicker]);

  const displayValue = open ? query : (selectedOption?.label ?? value ?? "");
  const activeOption =
    open && activeIndex >= 0 ? flatOptions[activeIndex] : undefined;

  return (
    <Container ref={containerRef}>
      <PickerInput
        ref={inputRef}
        value={displayValue}
        placeholder={value ? undefined : placeholder}
        $hasValue={!!value && !open}
        onFocus={openPicker}
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveIndex(-1);
        }}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          activeOption ? optionId(activeOption.key) : undefined
        }
      />
      {clearable && value && !open && (
        <ClearButton
          type="button"
          onClick={() => {
            onChange(null);
            closePicker();
          }}
        >
          ×
        </ClearButton>
      )}
      {open && (
        <Dropdown role="listbox" id={listboxId}>
          {flatOptions.length === 0 ? (
            <EmptyState>No matches</EmptyState>
          ) : (
            sortedGroups.map(([group, items]) => (
              <DropdownGroup key={group}>
                <GroupHeader>{group}</GroupHeader>
                {items.map((opt) => {
                  const globalIdx = flatOptions.indexOf(opt);
                  const isActive = globalIdx === activeIndex;
                  return (
                    <DropdownItem
                      key={opt.key}
                      id={optionId(opt.key)}
                      role="option"
                      aria-selected={isActive}
                      $active={isActive}
                      $selected={opt.key === value}
                      onPointerDown={(e) => {
                        // Prevent the input from losing focus (and triggering
                        // the outside-click dismiss) before the selection runs.
                        e.preventDefault();
                        selectOption(opt.key);
                      }}
                      onMouseEnter={() => setActiveIndex(globalIdx)}
                    >
                      <ItemLabel>{opt.label ?? opt.key}</ItemLabel>
                      {opt.unit && <ItemUnit>{opt.unit}</ItemUnit>}
                    </DropdownItem>
                  );
                })}
              </DropdownGroup>
            ))
          )}
        </Dropdown>
      )}
    </Container>
  );
}

const Container = styled.div`
  position: relative;
`;

const PickerInput = styled.input<{ $hasValue: boolean }>`
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: 3px;
  color: ${({ $hasValue }) => ($hasValue ? "var(--color-text-primary)" : "var(--color-text-muted)")};
  font-size: var(--font-size-base);
  padding: 6px 8px;
  box-sizing: border-box;
  width: 100%;

  &:focus {
    border-color: var(--color-text-faint);
    outline: none;
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }

  &::placeholder {
    color: var(--color-text-faint);
  }
`;

const ClearButton = styled.button`
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: var(--color-text-dim);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0 2px;

  &:hover {
    color: var(--color-text-primary);
  }
`;

const Dropdown = styled.div`
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: 3px;
  max-height: 280px;
  overflow-y: auto;
  z-index: 100;
`;

const DropdownGroup = styled.div``;

const GroupHeader = styled.div`
  font-size: var(--font-size-xs);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  padding: 8px 8px 4px;
  position: sticky;
  top: 0;
  background: var(--color-surface-raised);
`;

const DropdownItem = styled.div<{ $active: boolean; $selected: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 8px;
  cursor: pointer;
  background: ${({ $active, $selected }) =>
    $active
      ? "var(--color-border-subtle)"
      : $selected
        ? "var(--color-status-go-bg)"
        : "transparent"};

  &:hover {
    background: var(--color-border-subtle);
  }
`;

const ItemLabel = styled.span`
  font-size: 12px;
  color: var(--color-text-primary);
`;

const ItemUnit = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
  margin-left: 6px;
`;

const EmptyState = styled.div`
  padding: 12px 8px;
  font-size: 12px;
  color: var(--color-text-faint);
  text-align: center;
`;
