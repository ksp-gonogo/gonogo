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
  /**
   * What to call the thing the picked key names, for the message shown when a
   * saved key is no longer on offer. Defaults to "value".
   */
  subjectNoun?: string;
}

/**
 * Shown in place of a label when a saved key is not in `keys`.
 *
 * A key can go missing because the vocabulary moved on: a widget saved before a
 * Topic was renamed or retired still holds the name it had. Rendering that key
 * as its own raw string reads as a valid selection, so a graph series draws a
 * flat line and an alarm simply never fires. Both look like a reading of zero,
 * and a zero is a claim about the craft.
 */
const RETIRED_MESSAGE = "no longer available";

export function DataKeyPicker({
  keys,
  value,
  onChange,
  clearable = false,
  placeholder = "Search...",
  subjectNoun = "value",
}: DataKeyPickerProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const listboxId = useId();
  const optionIdPrefix = useId();
  const retiredId = useId();
  const optionId = (key: string) => `${optionIdPrefix}-${key}`;

  const selectedOption = keys.find((k) => k.key === value);
  // A key is retired once it is saved but no longer offered. Only judged when
  // there is a vocabulary to judge against: an empty `keys` means the catalogue
  // has not arrived, and calling every saved key retired at that moment would
  // report a broken widget on every mount.
  const retired =
    value !== null &&
    value !== "" &&
    selectedOption === undefined &&
    keys.length > 0;

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
        $retired={retired && !open}
        aria-invalid={retired && !open ? true : undefined}
        aria-describedby={retired && !open ? retiredId : undefined}
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
      {retired && !open && (
        <RetiredNote id={retiredId}>
          {`This ${subjectNoun} ${RETIRED_MESSAGE}. Pick another.`}
        </RetiredNote>
      )}
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

const PickerInput = styled.input<{ $hasValue: boolean; $retired?: boolean }>`
  background: var(--color-surface-raised);
  border: 1px solid ${({ $retired }) => ($retired ? "var(--color-status-nogo-fg)" : "var(--color-border-strong)")};
  border-radius: var(--radius-sm, 3px);
  color: ${({ $hasValue, $retired }) => {
    if ($retired) return "var(--color-status-nogo-fg)";
    return $hasValue ? "var(--color-text-primary)" : "var(--color-text-muted)";
  }};
  font-size: var(--font-size-base);
  padding: var(--space-6, 6px) var(--space-8, 8px);
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
  font-size: var(--font-size-lg);
  line-height: var(--line-height-flush, 1);
  padding: 0 var(--space-2, 2px);

  &:hover {
    color: var(--color-text-primary);
  }
`;

/**
 * Sits under the input rather than replacing its text, so the operator can
 * still read WHICH key went missing. Recovering a widget usually means picking
 * the value the retired one used to name, and that is easier when its name is
 * still on screen.
 */
const RetiredNote = styled.div`
  color: var(--color-status-nogo-fg);
  font-size: var(--font-size-xs);
  margin-top: var(--space-2, 2px);
`;

const ItemLabel = styled.span`
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
`;

const ItemUnit = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
  margin-left: var(--space-6, 6px);
`;
