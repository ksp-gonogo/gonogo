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

function statusState(entry: KosCpuEntry): "online" | "seen" | "unknown" {
  if (entry.online) return "online";
  if (entry.lastSeenAt === undefined) return "unknown";
  return "seen";
}

function statusTooltip(entry: KosCpuEntry, now: number = Date.now()): string {
  if (entry.online) return "Online — visible in the kOS menu now";
  if (entry.lastSeenAt === undefined) return "Never seen by discovery";
  const ageMs = Math.max(0, now - entry.lastSeenAt);
  const ageStr = formatAge(ageMs);
  return `Offline — last seen ${ageStr} ago`;
}

function formatAge(ms: number): string {
  if (ms < 1000) return "<1s";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} h`;
  return `${Math.round(ms / 86_400_000)} d`;
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
}: Readonly<KosCpuPickerProps>) {
  const entries = useCpuRegistry();
  const service = useCpuRegistryService();

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [mode, setMode] = useState<"list" | "add" | "manage">("list");
  const [draft, setDraft] = useState({
    tagname: "",
    label: "",
    description: "",
  });
  // Tagname currently being edited inline within the manage view (or null
  // for the row-list mode). Edits are local until Save.
  const [editing, setEditing] = useState<{
    tagname: string;
    label: string;
    description: string;
  } | null>(null);
  // Tagname pending delete-confirm — first × click sets this, second click
  // commits. A click on a different row resets it.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

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
    setMode("list");
    setEditing(null);
    setPendingDelete(null);
  }, []);

  const closePicker = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
    setMode("list");
    setEditing(null);
    setPendingDelete(null);
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
      const target = e.target as Node | null;
      if (!target) return;
      // Click handlers that swap modes (Add / Manage) unmount the button
      // they were attached to before the document-level handler runs.
      // `contains` then returns false on the detached target and closes
      // the picker spuriously. If the target was already removed from
      // the DOM by React's commit, treat it as an in-picker click.
      if (!document.body.contains(target)) return;
      if (!containerRef.current?.contains(target)) closePicker();
    };
    document.addEventListener("pointerdown", onOutside);
    return () => document.removeEventListener("pointerdown", onOutside);
  }, [open, closePicker]);

  // When the inline add form opens, focus the tagname field so the user
  // can start typing immediately. Pre-fill from the search query when the
  // form was opened via "Save 'foo' to registry".
  useEffect(() => {
    if (mode !== "add") return;
    draftTagnameRef.current?.focus();
  }, [mode]);

  const selectedDisplay = selected ? displayLabel(selected) : value;
  const displayValue = open ? query : selectedDisplay;

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
          {mode === "list" && (
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
                      <StatusDot
                        $state={statusState(entry)}
                        title={statusTooltip(entry)}
                        aria-label={statusTooltip(entry)}
                      />
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
              <FooterRow>
                <GhostButton
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setDraft({
                      tagname: trimmedQuery,
                      label: "",
                      description: "",
                    });
                    setMode("add");
                  }}
                >
                  + Add CPU…
                </GhostButton>
                {entries.length > 0 && (
                  <GhostButton
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      setMode("manage");
                    }}
                  >
                    Manage CPUs…
                  </GhostButton>
                )}
              </FooterRow>
            </>
          )}
          {mode === "add" && (
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
                    setMode("list");
                  }}
                >
                  Cancel
                </GhostButton>
              </FormRow>
            </AddForm>
          )}
          {mode === "manage" && (
            <ManageView
              onPointerDown={(e) => {
                // Same rationale as AddForm — keep the outside-click handler
                // from snapping the picker shut while the user clicks a
                // button or types inside an input.
                e.stopPropagation();
              }}
            >
              {entries.length === 0 ? (
                <EmptyState>
                  No CPUs in the registry yet. Add one to get started.
                </EmptyState>
              ) : (
                entries.map((entry) => {
                  const isEditing = editing?.tagname === entry.tagname;
                  const confirmingDelete = pendingDelete === entry.tagname;
                  if (isEditing) {
                    return (
                      <ManageRow key={entry.tagname}>
                        <Field>
                          <FieldLabel>Tagname</FieldLabel>
                          <ReadonlyValue>{entry.tagname}</ReadonlyValue>
                          <FieldHint>
                            Tagname is set in KSP — pick a new tagname there if
                            this one is wrong.
                          </FieldHint>
                        </Field>
                        <Field>
                          <FieldLabel
                            htmlFor={`${optionPrefix}-edit-label-${entry.tagname}`}
                          >
                            Label
                          </FieldLabel>
                          <Input
                            id={`${optionPrefix}-edit-label-${entry.tagname}`}
                            value={editing.label}
                            onChange={(e) =>
                              setEditing((prev) =>
                                prev
                                  ? { ...prev, label: e.target.value }
                                  : prev,
                              )
                            }
                          />
                        </Field>
                        <Field>
                          <FieldLabel
                            htmlFor={`${optionPrefix}-edit-desc-${entry.tagname}`}
                          >
                            Description
                          </FieldLabel>
                          <Textarea
                            id={`${optionPrefix}-edit-desc-${entry.tagname}`}
                            value={editing.description}
                            rows={2}
                            onChange={(e) =>
                              setEditing((prev) =>
                                prev
                                  ? { ...prev, description: e.target.value }
                                  : prev,
                              )
                            }
                          />
                        </Field>
                        <FormRow>
                          <PrimaryButton
                            type="button"
                            onPointerDown={(e) => {
                              e.preventDefault();
                              service.upsert({
                                tagname: entry.tagname,
                                label: editing.label,
                                description: editing.description,
                              });
                              setEditing(null);
                            }}
                          >
                            Save
                          </PrimaryButton>
                          <GhostButton
                            type="button"
                            onPointerDown={(e) => {
                              e.preventDefault();
                              setEditing(null);
                            }}
                          >
                            Cancel
                          </GhostButton>
                        </FormRow>
                      </ManageRow>
                    );
                  }
                  return (
                    <ManageRow key={entry.tagname}>
                      <ManageHeader>
                        <StatusDot
                          $state={statusState(entry)}
                          title={statusTooltip(entry)}
                          aria-label={statusTooltip(entry)}
                        />
                        <ManageMain>
                          <ItemLabel>{displayLabel(entry)}</ItemLabel>
                          {entry.label && entry.label !== entry.tagname && (
                            <ItemTag>{entry.tagname}</ItemTag>
                          )}
                          {entry.description && (
                            <ItemDescription>
                              {entry.description}
                            </ItemDescription>
                          )}
                        </ManageMain>
                        <ManageActions>
                          <GhostButton
                            type="button"
                            onPointerDown={(e) => {
                              e.preventDefault();
                              setPendingDelete(null);
                              setEditing({
                                tagname: entry.tagname,
                                label: entry.label ?? "",
                                description: entry.description ?? "",
                              });
                            }}
                          >
                            Edit
                          </GhostButton>
                          <DeleteButton
                            type="button"
                            $confirming={confirmingDelete}
                            onPointerDown={(e) => {
                              e.preventDefault();
                              if (confirmingDelete) {
                                service.remove(entry.tagname);
                                setPendingDelete(null);
                              } else {
                                setPendingDelete(entry.tagname);
                              }
                            }}
                          >
                            {confirmingDelete ? "Confirm?" : "Delete"}
                          </DeleteButton>
                        </ManageActions>
                      </ManageHeader>
                    </ManageRow>
                  );
                })
              )}
              <FooterRow>
                <GhostButton
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setMode("list");
                    setEditing(null);
                    setPendingDelete(null);
                  }}
                >
                  Done
                </GhostButton>
              </FooterRow>
            </ManageView>
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
  background: ${({ $active, $selected }) => {
    if ($active) return "var(--color-border-subtle)";
    if ($selected) return "var(--color-status-go-bg)";
    return "transparent";
  }};

  &:hover {
    background: var(--color-border-subtle);
  }
`;

const ItemMain = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const StatusDot = styled.span<{ $state: "online" | "seen" | "unknown" }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: ${({ $state }) => {
    if ($state === "online") return "var(--color-status-go-fg)";
    if ($state === "seen") return "var(--color-text-faint)";
    return "transparent";
  }};
  border: 1px solid
    ${({ $state }) => {
      if ($state === "online") return "var(--color-status-go-fg)";
      if ($state === "seen") return "var(--color-text-faint)";
      return "var(--color-border-subtle)";
    }};
  box-shadow: ${({ $state }) =>
    $state === "online" ? "0 0 6px var(--color-status-go-fg)" : "none"};
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

const FooterRow = styled.div`
  border-top: 1px solid var(--color-border-subtle);
  padding: 6px 8px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`;

const ManageView = styled.div`
  display: flex;
  flex-direction: column;
`;

const ManageRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border-subtle);
  &:last-of-type {
    border-bottom: none;
  }
`;

const ManageHeader = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
`;

const ManageMain = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
`;

const ManageActions = styled.div`
  display: flex;
  gap: 4px;
  flex: 0 0 auto;
`;

const DeleteButton = styled.button<{ $confirming: boolean }>`
  background: ${({ $confirming }) =>
    $confirming ? "var(--color-status-nogo-bg)" : "transparent"};
  color: ${({ $confirming }) =>
    $confirming ? "var(--color-status-nogo-fg)" : "var(--color-text-muted)"};
  border: 1px solid var(--color-status-alert-muted);
  border-radius: 3px;
  padding: 3px 8px;
  font-size: var(--font-size-xs);
  cursor: pointer;
  &:hover {
    background: var(--color-status-nogo-bg);
    color: var(--color-status-nogo-fg);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const ReadonlyValue = styled.div`
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--color-text-muted);
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-subtle);
  border-radius: 3px;
  padding: 4px 8px;
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
