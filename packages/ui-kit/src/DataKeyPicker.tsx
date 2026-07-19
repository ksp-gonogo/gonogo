import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import styled from "styled-components";
import {
  ComboboxListbox,
  type ComboboxOption,
  filterComboboxOptions,
  flattenComboboxGroups,
  groupComboboxOptions,
  moveComboboxActiveIndex,
} from "./Combobox";

export interface KeyOption extends ComboboxOption {
  unit?: string;
}

export interface DataKeyPickerProps {
  keys: KeyOption[];
  value: string | null;
  onChange: (key: string | null) => void;
  clearable?: boolean;
  placeholder?: string;
}

export function DataKeyPicker({
  keys,
  value,
  onChange,
  clearable = false,
  placeholder = "Search...",
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
    () => filterComboboxOptions(keys, query),
    [keys, query],
  );

  const sortedGroups = useMemo(
    () => groupComboboxOptions(filtered),
    [filtered],
  );

  const flatOptions = useMemo(
    () => flattenComboboxGroups(sortedGroups),
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
      setActiveIndex((i) => moveComboboxActiveIndex(i, 1, flatOptions.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => moveComboboxActiveIndex(i, -1, flatOptions.length));
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
        <ComboboxListbox
          id={listboxId}
          groups={sortedGroups}
          flatOptions={flatOptions}
          activeIndex={activeIndex}
          selectedKey={value}
          getOptionId={optionId}
          onHoverIndex={setActiveIndex}
          onSelectKey={selectOption}
          renderItem={(opt) => (
            <>
              <ItemLabel>{opt.label ?? opt.key}</ItemLabel>
              {opt.unit && <ItemUnit>{opt.unit}</ItemUnit>}
            </>
          )}
        />
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

const ItemLabel = styled.span`
  font-size: 12px;
  color: var(--color-text-primary);
`;

const ItemUnit = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
  margin-left: 6px;
`;
