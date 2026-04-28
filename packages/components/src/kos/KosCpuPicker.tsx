import {
  type KosCpuEntry,
  useCpuRegistry,
  useCpuRegistryService,
} from "@gonogo/data";
import {
  Field,
  FieldHint,
  FieldLabel,
  GhostButton,
  Input,
  PrimaryButton,
  Textarea,
} from "@gonogo/ui";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import styled from "styled-components";

/**
 * Combobox for picking a kOS CPU tagname from the per-screen registry,
 * with an inline "+ Add CPU" form for entries that aren't in the list
 * yet. The picker is the canonical CPU input for every kOS widget —
 * before this, every widget had its own free-text Input and there was
 * nowhere to record a CPU's purpose.
 *
 * `value` may legitimately be a tagname not present in the registry
 * (e.g. config saved before a CPU was added to the registry, or a
 * tagname typed directly into the search field). The picker shows it
 * as the selected value and offers "Save 'foo' to registry" so the
 * user can promote it without retyping.
 */
export interface KosCpuPickerProps {
  value: string;
  onChange: (tagname: string) => void;
  /** Forwarded to the input for label htmlFor wiring. */
  id?: string;
  placeholder?: string;
}

function displayLabel(entry: KosCpuEntry): string {
  return entry.label ?? entry.tagname;
}

function matches(entry: KosCpuEntry, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    entry.tagname.toLowerCase().includes(needle) ||
    (entry.label?.toLowerCase().includes(needle) ?? false) ||
    (entry.description?.toLowerCase().includes(needle) ?? false)
  );
}

export function KosCpuPicker({
  value,
  onChange,
  id,
  placeholder = "Select or add a kOS CPU…",
}: KosCpuPickerProps) {
  const entries = useCpuRegistry();
  const service = useCpuRegistryService();

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({
    tagname: "",
    label: "",
    description: "",
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const draftTagnameRef = useRef<HTMLInputElement>(null);

  const listboxId = useId();
  const optionPrefix = useId();
  const optionId = (tag: string) => `${optionPrefix}-${tag}`;

  const filtered = useMemo(
    () => entries.filter((e) => matches(e, query)),
    [entries, query],
  );

  // If `value` isn't in the registry yet, surface it as the selected display
  // even though we can't show extra metadata for it.
  const selected = useMemo(
    () => entries.find((e) => e.tagname === value),
    [entries, value],
  );

  // Show "Save 'foo' to registry" when the typed query doesn't match any
  // existing tagname — lets a user promote a free-text value without
  // having to open the Add form manually.
  const trimmedQuery = query.trim();
  const showQuickAdd =
    trimmedQuery.length > 0 && !entries.some((e) => e.tagname === trimmedQuery);

  const openPicker = useCallback(() => {
    setOpen(true);
    setQuery("");
    setActiveIndex(-1);
    setAdding(false);
  }, []);

  const closePicker = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
    setAdding(false);
  }, []);

  const selectEntry = useCallback(
    (tagname: string) => {
      onChange(tagname);
      closePicker();
    },
    [onChange, closePicker],
  );

  const handleQuickAdd = useCallback(
    (tagname: string) => {
      const trimmed = tagname.trim();
      if (!trimmed) return;
      service.upsert({ tagname: trimmed });
      onChange(trimmed);
      closePicker();
    },
    [service, onChange, closePicker],
  );

  const handleAddSubmit = useCallback(() => {
    const trimmed = draft.tagname.trim();
    if (!trimmed) {
      // Pulse focus back to the tagname field; nothing to save.
      draftTagnameRef.current?.focus();
      return;
    }
    service.upsert({
      tagname: trimmed,
      label: draft.label,
      description: draft.description,
    });
    onChange(trimmed);
    closePicker();
  }, [draft, service, onChange, closePicker]);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === "Enter" || e.key === "ArrowDown") openPicker();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closePicker();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const opt =
        activeIndex >= 0 ? filtered[activeIndex] : (filtered[0] ?? null);
      if (opt) {
        selectEntry(opt.tagname);
      } else if (showQuickAdd) {
        handleQuickAdd(trimmedQuery);
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

  // When the inline add form opens, focus the tagname field so the user
  // can start typing immediately. Pre-fill from the search query when the
  // form was opened via "Save 'foo' to registry".
  useEffect(() => {
    if (!adding) return;
    draftTagnameRef.current?.focus();
  }, [adding]);

  const displayValue = open ? query : selected ? displayLabel(selected) : value;

  const activeOption =
    open && activeIndex >= 0 ? filtered[activeIndex] : undefined;

  return (
    <Container ref={containerRef}>
      <PickerInput
        ref={inputRef}
        id={id}
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
          activeOption ? optionId(activeOption.tagname) : undefined
        }
      />
      {open && (
        <Dropdown role="listbox" id={listboxId}>
          {!adding && (
            <>
              {filtered.length === 0 && !showQuickAdd && (
                <EmptyState>
                  No CPUs yet — add one to start configuring widgets.
                </EmptyState>
              )}
              {filtered.map((entry, idx) => {
                const isActive = idx === activeIndex;
                const isSelected = entry.tagname === value;
                return (
                  <DropdownItem
                    key={entry.tagname}
                    id={optionId(entry.tagname)}
                    role="option"
                    aria-selected={isActive}
                    $active={isActive}
                    $selected={isSelected}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      selectEntry(entry.tagname);
                    }}
                    onMouseEnter={() => setActiveIndex(idx)}
                  >
                    <ItemMain>
                      <ItemLabel>{displayLabel(entry)}</ItemLabel>
                      {entry.label && entry.label !== entry.tagname && (
                        <ItemTag>{entry.tagname}</ItemTag>
                      )}
                    </ItemMain>
                    {entry.description && (
                      <ItemDescription>{entry.description}</ItemDescription>
                    )}
                  </DropdownItem>
                );
              })}
              {showQuickAdd && (
                <DropdownItem
                  role="option"
                  aria-selected={false}
                  $active={false}
                  $selected={false}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    handleQuickAdd(trimmedQuery);
                  }}
                >
                  <ItemMain>
                    <ItemLabel>
                      Save “{trimmedQuery}” as a new CPU tagname
                    </ItemLabel>
                  </ItemMain>
                  <ItemDescription>
                    Adds a bare entry — open the picker again to label it.
                  </ItemDescription>
                </DropdownItem>
              )}
              <AddRow>
                <GhostButton
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setDraft({
                      tagname: trimmedQuery,
                      label: "",
                      description: "",
                    });
                    setAdding(true);
                  }}
                >
                  + Add CPU…
                </GhostButton>
              </AddRow>
            </>
          )}
          {adding && (
            <AddForm
              onPointerDown={(e) => {
                // Stop the input's outside-click handler from closing the
                // picker when interacting with form controls.
                e.stopPropagation();
              }}
            >
              <Field>
                <FieldLabel htmlFor={`${optionPrefix}-add-tag`}>
                  Tagname
                </FieldLabel>
                <Input
                  id={`${optionPrefix}-add-tag`}
                  ref={draftTagnameRef}
                  value={draft.tagname}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, tagname: e.target.value }))
                  }
                  placeholder="e.g. lander"
                />
                <FieldHint>
                  The kOS part&apos;s tagname (set via the kOS part&apos;s
                  right-click menu in KSP). This is what widgets dispatch
                  against.
                </FieldHint>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${optionPrefix}-add-label`}>
                  Label (optional)
                </FieldLabel>
                <Input
                  id={`${optionPrefix}-add-label`}
                  value={draft.label}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, label: e.target.value }))
                  }
                  placeholder="e.g. Lander Computer"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${optionPrefix}-add-desc`}>
                  Description (optional)
                </FieldLabel>
                <Textarea
                  id={`${optionPrefix}-add-desc`}
                  value={draft.description}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, description: e.target.value }))
                  }
                  placeholder="Purpose of this CPU on the vessel"
                  rows={2}
                />
              </Field>
              <FormRow>
                <PrimaryButton
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    handleAddSubmit();
                  }}
                >
                  Save
                </PrimaryButton>
                <GhostButton
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setAdding(false);
                  }}
                >
                  Cancel
                </GhostButton>
              </FormRow>
            </AddForm>
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
  color: ${({ $hasValue }) =>
    $hasValue ? "var(--color-text-primary)" : "var(--color-text-muted)"};
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

const Dropdown = styled.div`
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-strong);
  border-radius: 3px;
  max-height: 360px;
  overflow-y: auto;
  z-index: 100;
`;

const DropdownItem = styled.div<{ $active: boolean; $selected: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
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

const ItemMain = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
`;

const ItemLabel = styled.span`
  font-size: 12px;
  color: var(--color-text-primary);
`;

const ItemTag = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
  font-family: var(--font-mono, monospace);
`;

const ItemDescription = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
`;

const EmptyState = styled.div`
  padding: 12px 8px;
  font-size: 12px;
  color: var(--color-text-faint);
  text-align: center;
`;

const AddRow = styled.div`
  border-top: 1px solid var(--color-border-subtle);
  padding: 6px 8px;
`;

const AddForm = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
`;

const FormRow = styled.div`
  display: flex;
  gap: 8px;
  justify-content: flex-end;
`;
