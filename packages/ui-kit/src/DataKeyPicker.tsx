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
import { focusRing } from "./focusRing";

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
   * saved key is no longer on offer and for the clear control's name. Defaults
   * to "value".
   */
  subjectNoun?: string;
  /** Put on the input, so a `<label htmlFor>` elsewhere names it. */
  id?: string;
  /** Names the input when no label points at it. */
  "aria-label"?: string;
}

/**
 * Shown in place of a label when a saved key is not in `keys`: rendering the
 * raw key would read as a valid selection that silently reads nothing.
 */
const RETIRED_MESSAGE = "no longer available";

export function DataKeyPicker({
  keys,
  value,
  onChange,
  clearable = false,
  placeholder = "Search...",
  subjectNoun = "value",
  id,
  "aria-label": ariaLabel,
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
  // An empty `keys` is a catalogue that has not arrived, so nothing is judged retired against it.
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
    switch (e.key) {
      case "Escape":
        closePicker();
        break;
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) =>
          moveComboboxActiveIndex(i, 1, flatOptions.length),
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) =>
          moveComboboxActiveIndex(i, -1, flatOptions.length),
        );
        break;
      case "Enter": {
        // Falls back to the first filtered result, so a partial label plus Enter works.
        const opt =
          activeIndex >= 0 ? flatOptions[activeIndex] : flatOptions[0];
        if (opt) selectOption(opt.key);
        break;
      }
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
        id={id}
        aria-label={ariaLabel}
        value={displayValue}
        placeholder={value ? undefined : placeholder}
        $hasValue={!!value && !open}
        $retired={retired && !open}
        aria-invalid={retired && !open ? true : undefined}
        aria-describedby={retired && !open ? retiredId : undefined}
        onFocus={openPicker}
        onBlur={closePicker}
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
          aria-label={`Clear ${subjectNoun}`}
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
          ariaLabel={ariaLabel ?? "Data keys"}
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
  border-radius: var(--radius-regular);
  color: ${({ $hasValue, $retired }) => {
    if ($retired) return "var(--color-status-nogo-fg)";
    return $hasValue ? "var(--color-text-primary)" : "var(--color-text-muted)";
  }};
  font-size: var(--font-size-value);
  padding: var(--inset-field);
  width: 100%;

  &:focus {
    border-color: var(--color-text-faint);
    outline: none;
  }

  ${focusRing}

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
  line-height: var(--line-height-flush);
  padding: var(--inset-glyph-tight);

  &:hover {
    color: var(--color-text-primary);
  }

  ${focusRing}
`;

/**
 * Sits under the input rather than replacing its text, so the operator can
 * still read which key went missing.
 */
const RetiredNote = styled.div`
  color: var(--color-status-nogo-fg);
  font-size: var(--font-size-compact);
  margin-top: var(--gap-caption);
`;

const ItemLabel = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-primary);
`;

const ItemUnit = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
  margin-left: var(--gap-trailing-mark);
`;
