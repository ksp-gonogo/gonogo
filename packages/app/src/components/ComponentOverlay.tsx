import { availableAtSeat } from "@ksp-gonogo/components";
import type { ComponentDefinition } from "@ksp-gonogo/core";
import {
  effectiveSearchTags,
  getComponents,
  safeRandomUuid,
  uplinkAdditions,
  uplinkOwner,
  useChromeWrap,
  useSeat,
} from "@ksp-gonogo/core";
import {
  SerialDeviceProvider,
  useSerialDeviceService,
} from "@ksp-gonogo/serial";
import {
  CloseIcon,
  Fab,
  FabClusterToggle,
  FilterChip,
  PlusIcon,
  Tag,
  useModal,
} from "@ksp-gonogo/ui";
import {
  Badge,
  Box,
  Button,
  CheckIcon,
  LayersIcon,
  Tooltip,
  useSizeDeltaFor,
  withSizeDelta,
} from "@ksp-gonogo/ui-kit";
import type { KeyboardEvent, ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styled from "styled-components";
import type { DashboardItem } from "./Dashboard";

/** A saved layout other than the one on screen, as far as the picker needs it: its name and what is on it. */
export interface OtherLayout {
  name: string;
  items: readonly Pick<DashboardItem, "componentId">[];
}

type NewItem = { item: DashboardItem; placement: { w: number; h: number } };

// Context: lets the overlay call addItems without prop-drilling.
interface OverlayContextValue {
  addItems: (entries: readonly NewItem[]) => void;
  /** The widgets on the layout on screen, which the picker marks. */
  items: readonly Pick<DashboardItem, "componentId">[];
  /** The other saved layouts, whose widgets the picker marks differently. */
  otherLayouts: readonly OtherLayout[];
  updateItemConfig: (id: string, config: Record<string, unknown>) => void;
  /** Whether the picker is open. Held here so a control outside the overlay can open it. */
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
}

const OverlayContext = createContext<OverlayContextValue | null>(null);

const NO_ITEMS: readonly Pick<DashboardItem, "componentId">[] = [];
const NO_LAYOUTS: readonly OtherLayout[] = [];

export function OverlayProvider({
  children,
  addItems,
  updateItemConfig,
  items = NO_ITEMS,
  otherLayouts = NO_LAYOUTS,
}: Readonly<{
  children: ReactNode;
  addItems: (entries: readonly NewItem[]) => void;
  updateItemConfig: (id: string, config: Record<string, unknown>) => void;
  items?: readonly Pick<DashboardItem, "componentId">[];
  otherLayouts?: readonly OtherLayout[];
}>) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const value = useMemo(
    () => ({
      addItems,
      items,
      otherLayouts,
      updateItemConfig,
      pickerOpen,
      setPickerOpen,
    }),
    [addItems, items, otherLayouts, updateItemConfig, pickerOpen],
  );
  return (
    <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>
  );
}

/**
 * Opens the Add widget picker, or `null` where no picker is mounted, so a
 * caller outside one renders no control that would do nothing.
 */
export function useOpenComponentPicker(): (() => void) | null {
  const ctx = useContext(OverlayContext);
  if (!ctx) return null;
  const { setPickerOpen } = ctx;
  return () => setPickerOpen(true);
}

function useOverlay(): OverlayContextValue {
  const ctx = useContext(OverlayContext);
  if (!ctx) throw new Error("useOverlay must be used inside <OverlayProvider>");
  return ctx;
}

export function ComponentOverlay({
  bottom = 84,
}: Readonly<{ bottom?: number }>) {
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(
    () => new Set(),
  );
  // Roving selection cursor for keyboard navigation of the results list. The
  // search input keeps DOM focus (combobox pattern) and the active option is
  // tracked via aria-activedescendant, so the user can keep typing to filter
  // while arrows move the highlight.
  const [activeIdx, setActiveIdx] = useState(0);
  // Ids of the widgets ticked for the next Add, in the order they were ticked.
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const activeOptionRef = useRef<HTMLButtonElement | null>(null);

  const {
    addItems,
    items,
    otherLayouts,
    updateItemConfig,
    pickerOpen: open,
    setPickerOpen: setOpen,
  } = useOverlay();
  const { open: openModal, close: closeModal } = useModal();
  const sizeDeltaFor = useSizeDeltaFor();
  // ModalProvider lives at the app root, above SerialDeviceProvider. Config
  // components opened here via `openConfigOnAdd` portal out of the provider
  // subtree, so we capture the service screen-side and re-provide it inside
  // the modal content. Same pattern as the dashboard's GearButton.
  // SerialDeviceProvider is the one remaining hand-wired case (out of scope
  // for the generic chrome-provider registry: see chromeProviders.ts's
  // design note). Any OTHER context a widget's config UI reaches for
  // (KosCpuPicker → CpuRegistryContext, etc.) is supplied generically via
  // registerChromeProvider/useChromeWrap instead of a hand-added re-wrap.
  const serialService = useSerialDeviceService();
  const wrapChrome = useChromeWrap();

  const allComponents = getComponents();
  const seat = useSeat();

  const placement = useMemo(() => {
    const here = new Map<string, number>();
    for (const it of items) {
      here.set(it.componentId, (here.get(it.componentId) ?? 0) + 1);
    }
    const elsewhere = new Map<string, string[]>();
    for (const layout of otherLayouts) {
      for (const id of new Set(layout.items.map((it) => it.componentId))) {
        elsewhere.set(id, [...(elsewhere.get(id) ?? []), layout.name]);
      }
    }
    return { here, elsewhere };
  }, [items, otherLayouts]);

  // Tag → count, descending. Drives the chip row below the search box so the
  // most-used tags appear first. Singleton tags (only one widget carries
  // them) are hidden.
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const def of allComponents) {
      for (const t of effectiveSearchTags(def))
        counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0]);
      });
  }, [allComponents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allComponents.filter((def) => {
      /*
       * The COSMETIC half of the seat rule: this stops a ground instrument
       * being offered here, and `SeatGuard` in the orchestrator is what stops
       * it rendering when one arrives by any of the other paths that put an
       * item in `items[]` (mission-profile replace, scene auto-switch, backup
       * restore, raw localStorage, peer widget-push).
       */
      if (!availableAtSeat(def, seat)) return false;
      const searchTags = effectiveSearchTags(def);
      if (q) {
        const matchesQuery =
          def.name.toLowerCase().includes(q) ||
          searchTags.some((t) => t.toLowerCase().includes(q));
        if (!matchesQuery) return false;
      }
      if (selectedTags.size > 0) {
        // Additive: a widget passes if it matches ANY selected tag.
        const matchesTag = searchTags.some((t) => selectedTags.has(t));
        if (!matchesTag) return false;
      }
      return true;
    });
  }, [allComponents, query, selectedTags, seat]);

  // Clamp the roving cursor whenever the filtered list shrinks below it,
  // otherwise Enter would activate the wrong widget (or read undefined when
  // the index points past the end of the array). Resets to the top when the
  // list grows from empty, so a fresh query starts highlighting the first hit.
  useEffect(() => {
    setActiveIdx((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Keep the highlighted option scrolled into view as arrows move past the
  // visible edge of the scrolling List. Optional-call the method, jsdom (and
  // any non-DOM host) doesn't implement scrollIntoView. activeIdx is the
  // intentional trigger: the effect reads activeOptionRef and re-runs on each
  // cursor move; dropping it from the deps would stop scroll-on-navigation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeIdx is the intentional scroll trigger, read via ref.
  useEffect(() => {
    activeOptionRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [activeIdx]);

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }, []);

  const closeOverlay = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelectedTags(new Set());
    setSelectedIds([]);
    setActiveIdx(0);
  }, [setOpen]);

  /* Multi-select lasts while anything is ticked, so a click adds one widget until a checkbox is pressed and goes back to doing so when the last tick is cleared. */
  const multiSelect = selectedIds.length > 0;

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }, []);

  const handleAdd = useCallback(
    (defs: readonly ComponentDefinition[]) => {
      if (defs.length === 0) return;
      const added = defs.map((def) => {
        const item: DashboardItem = {
          i: safeRandomUuid(),
          componentId: def.id,
          config: def.defaultConfig ? { ...def.defaultConfig } : undefined,
        };
        const sized = withSizeDelta(def, sizeDeltaFor(def));
        const defaultSize = sized.defaultSize ?? { w: 3, h: 3 };
        const min = sized.minSize;
        const max = sized.maxSize;
        const floored = min
          ? {
              w: Math.max(defaultSize.w, min.w),
              h: Math.max(defaultSize.h, min.h),
            }
          : defaultSize;
        const size = max
          ? { w: Math.min(floored.w, max.w), h: Math.min(floored.h, max.h) }
          : floored;
        return { def, item, placement: size };
      });
      addItems(added);
      closeOverlay();

      for (const { def, item } of added) {
        if (!def.openConfigOnAdd || !def.configComponent) continue;
        const ConfigComp = def.configComponent;
        const modalId = openModal(
          <SerialDeviceProvider service={serialService}>
            {wrapChrome(
              <ConfigComp
                config={item.config ?? def.defaultConfig ?? {}}
                onSave={(newConfig: Record<string, unknown>) => {
                  // Persist the user's freshly-entered config to the item
                  // that addItems just placed. Without this, the on-add modal
                  // was cosmetic, the widget reverted to defaultConfig.
                  updateItemConfig(item.i, newConfig);
                  closeModal(modalId);
                }}
              />,
            )}
          </SerialDeviceProvider>,
          { title: def.name },
        );
      }
    },
    [
      addItems,
      updateItemConfig,
      sizeDeltaFor,
      openModal,
      closeModal,
      closeOverlay,
      serialService,
      wrapChrome,
    ],
  );

  const addSelected = useCallback(() => {
    const byId = new Map(allComponents.map((d) => [d.id, d]));
    handleAdd(
      selectedIds.flatMap((id) => {
        const def = byId.get(id);
        return def ? [def] : [];
      }),
    );
  }, [allComponents, selectedIds, handleAdd]);

  // Combobox keyboard nav: arrows move the roving selection through the
  // filtered results, Enter activates the highlighted widget. Clamps at the
  // ends (APG-consistent for a search-filtered listbox: wrapping is jarring
  // when you're scanning a list you filtered yourself). Escape still closes.
  // Shift+Enter ticks or unticks the highlighted widget.
  const handleSearchKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        closeOverlay();
        return;
      }
      if (filtered.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        setActiveIdx(0);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        setActiveIdx(filtered.length - 1);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const def = filtered[activeIdx] ?? filtered[0];
        if (e.shiftKey) {
          if (def) toggleSelected(def.id);
          return;
        }
        // Enter adds what is ticked; with nothing ticked it adds the highlighted widget.
        if (selectedIds.length > 0) {
          addSelected();
          return;
        }
        if (def) handleAdd([def]);
      }
    },
    [
      filtered,
      activeIdx,
      handleAdd,
      toggleSelected,
      selectedIds,
      addSelected,
      closeOverlay,
    ],
  );

  const listboxId = "component-overlay-listbox";
  const optionId = (id: string) => `component-overlay-option-${id}`;
  const activeDef = filtered[activeIdx];

  return (
    <>
      <FabClusterToggle />
      <Tooltip text="Add widget (Ctrl/Cmd+K)">
        <Fab
          bottom={bottom}
          onClick={() => setOpen(true)}
          aria-label="Add widget"
          aria-keyshortcuts="Control+K Meta+K"
        >
          <PlusIcon />
        </Fab>
      </Tooltip>

      {open && (
        <Backdrop onClick={closeOverlay}>
          <OverlaySurface
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Add a widget"
          >
            <SearchRow>
              <SearchInput
                autoFocus
                placeholder="Search widgets..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                role="combobox"
                aria-expanded
                aria-controls={listboxId}
                aria-autocomplete="list"
                aria-activedescendant={
                  activeDef ? optionId(activeDef.id) : undefined
                }
                aria-label="Search widgets"
              />
              <CloseBtn onClick={closeOverlay} aria-label="Close">
                <CloseIcon size={16} />
              </CloseBtn>
            </SearchRow>
            {tagCounts.length > 0 && (
              <ChipRow
                role="group"
                aria-label="Filter by tag (any selected match)"
              >
                {tagCounts.map(([tag, count]) => (
                  <FilterChip
                    key={tag}
                    label={tag}
                    count={count}
                    selected={selectedTags.has(tag)}
                    onToggle={() => toggleTag(tag)}
                  />
                ))}
              </ChipRow>
            )}
            <ResultsHeader>
              {filtered.length} of {allComponents.length} widgets
            </ResultsHeader>
            {/* The options sit beside their checkboxes, which a listbox may not contain, so the listbox owns them by id instead. */}
            <div
              id={listboxId}
              role="listbox"
              aria-label="Available widgets"
              aria-multiselectable
              aria-owns={filtered.map((d) => optionId(d.id)).join(" ")}
            />
            <List>
              {filtered.length === 0 && (
                <Empty>
                  No widgets match "{query}"
                  {selectedTags.size > 0 && " in selected tags"}
                </Empty>
              )}
              {filtered.map((def, i) => {
                const active = i === activeIdx;
                const ticked = selectedIds.includes(def.id);
                const onHere = placement.here.get(def.id);
                const onOthers = placement.elsewhere.get(def.id);
                return (
                  <ListRow key={def.id} $active={active} $ticked={ticked}>
                    <ListItem
                      id={optionId(def.id)}
                      role="option"
                      aria-selected={ticked}
                      ref={active ? activeOptionRef : undefined}
                      // Pointer focus moves the roving cursor so a subsequent keystroke continues from where the mouse last hovered.
                      onMouseEnter={() => setActiveIdx(i)}
                      // Keeps focus in the search box, so ticking with the pointer does not end keyboard use.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() =>
                        multiSelect ? toggleSelected(def.id) : handleAdd([def])
                      }
                    >
                      <ItemHead>
                        <ItemTitle>
                          <ItemName>{def.name}</ItemName>
                          {uplinkOwner(def) && (
                            <ItemOwner>{uplinkOwner(def)?.name}</ItemOwner>
                          )}
                        </ItemTitle>
                        {onHere !== undefined && (
                          <OnLayoutMark
                            role="img"
                            aria-label={`On this layout${onHere > 1 ? ` x${onHere}` : ""}`}
                          >
                            <LayersIcon size={22} />
                            <OnLayoutTick>
                              <CheckIcon size={13} />
                            </OnLayoutTick>
                          </OnLayoutMark>
                        )}
                        {onOthers !== undefined && (
                          <Tooltip text={`On ${onOthers.join(", ")}`}>
                            <Badge size="sm">
                              <BadgeContent>
                                <LayersIcon size={10} />
                                On another layout
                              </BadgeContent>
                            </Badge>
                          </Tooltip>
                        )}
                      </ItemHead>
                      {uplinkAdditions(def).length > 0 && (
                        <ExtenderRow>
                          {uplinkAdditions(def).map((u) => (
                            <Tag
                              key={u.id}
                              label={u.name}
                              symbol={<PlusIcon size={8} />}
                              name
                            />
                          ))}
                        </ExtenderRow>
                      )}
                      <ItemDesc>{def.description}</ItemDesc>
                      <TagRow>
                        {def.tags.map((t) => (
                          <Tag key={t} label={t} />
                        ))}
                      </TagRow>
                    </ListItem>
                    <TickCell>
                      <TickBox
                        type="checkbox"
                        aria-label={`Select ${def.name}`}
                        checked={ticked}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleSelected(def.id)}
                      />
                    </TickCell>
                  </ListRow>
                );
              })}
            </List>
            {selectedIds.length > 0 && (
              <AddBar>
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => setSelectedIds([])}
                >
                  Clear
                </Button>
                <Button variant="primary" type="button" onClick={addSelected}>
                  {selectedIds.length === 1
                    ? "Add 1 widget"
                    : `Add ${selectedIds.length} widgets`}
                </Button>
              </AddBar>
            )}
          </OverlaySurface>
        </Backdrop>
      )}
    </>
  );
}

export { useOverlay };

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-backdrop);
`;

// The surface, border and radius are the kit's Box; the spotlight geometry is
// this overlay's. It floats above the app, so it takes the floating corner.
const OverlaySurface = styled(Box).attrs({
  surface: "panel" as const,
  bordered: true,
  radius: "floating" as const,
})`
  width: 560px;
  max-width: 95vw;
  /* Spotlight-style stable height: regardless of how many results match,
     the panel is the same size. Filtering narrows the list inside, never
     resizes the wrapper. */
  height: min(640px, 80vh);
  height: min(640px, 80dvh);
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.7);
  overflow: hidden;
`;

const SearchRow = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
  /* On the overlay gutter that ResultsHeader, ChipRow and ListItem below
     share, so the search text lines up with every band under it. */
  padding: var(--inset-overlay-band);
  border-bottom: 1px solid var(--color-surface-raised);
  flex-shrink: 0;
`;

const CloseBtn = styled.button`
  background: none;
  border: none;
  color: var(--color-text-faint);
  cursor: pointer;
  padding: var(--inset-control);
  border-radius: var(--radius-regular);
  &:hover {
    color: var(--color-text-primary);
    background: var(--color-surface-raised);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
  @media (pointer: coarse) {
    min-width: 44px;
    min-height: 44px;
  }
`;

const SearchInput = styled.input`
  flex: 1;
  background: transparent;
  border: none;
  color: var(--color-text-primary);
  /* Literal, not --font-size-lg: 16px is the iOS Safari auto-zoom threshold
     and a focused input below it zooms the whole page. The token is 16px
     today so a swap would work, but it silently reintroduces the zoom the
     moment lg is retuned. Same exception as ui-kit/Form.tsx. */
  font-size: 16px;
  padding: var(--inset-search-input);

  &:focus {
    outline: none;
  }

  &::placeholder {
    color: var(--color-text-faint);
  }
`;

const ResultsHeader = styled.div`
  padding: var(--inset-overlay-heading);
  font-size: var(--font-size-caption);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  flex-shrink: 0;
`;

const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-related);
  /* Same gutter column as the rows above and below; see ResultsHeader. */
  padding: var(--inset-overlay-chips);
  border-bottom: 1px solid var(--color-surface-raised);
  flex-shrink: 0;

  /* On touch the chips are 44px tall, so wrapped rows would take the screen from the results: one row that scrolls sideways instead. */
  @media (pointer: coarse) {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
    & > * {
      flex: 0 0 auto;
    }
  }
`;

const List = styled.div`
  overflow-y: auto;
  flex: 1;
`;

const ListRow = styled.div<{ $active?: boolean; $ticked?: boolean }>`
  display: flex;
  align-items: flex-start;
  background: ${(p) => (p.$active || p.$ticked ? "var(--color-surface-raised)" : "none")};
  border-bottom: 1px solid var(--color-surface-panel);
  /* The roving highlight is the keyboard cursor; mirror it with an inset
     accent rule so it reads as "selected" while DOM focus stays in the
     search box (combobox + aria-activedescendant pattern). */
  box-shadow: ${(p) =>
    p.$active ? "inset 2px 0 0 0 var(--color-accent-fg)" : "none"};

  &:hover {
    background: var(--color-surface-raised);
  }
  &:last-child {
    border-bottom: none;
  }
`;

const ListItem = styled.button`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
  flex: 1;
  min-width: 0;
  text-align: left;
  background: none;
  border: none;
  /* A full-width record on the picker's gutter, not a control, whatever the
     element is: --inset-control would pull a row that spans the whole overlay
     in to a button's width and off the column the header above it sits on. */
  padding: var(--inset-overlay-band);
  cursor: pointer;

  &:focus-visible {
    /* Inset ring: the ancestor is overflow: hidden, so a positive offset
       would clip it away entirely. Ring geometry, never a spacing rung. */
    outline: 2px solid var(--color-accent-fg);
    outline-offset: -2px;
  }
`;

const ItemHead = styled.span`
  display: flex;
  align-items: center;
  gap: var(--gap-related);
  min-width: 0;
`;

/** The checkbox on a row: pressing it ticks the widget and starts multi-select. */
/** Holds the checkbox level with the row's first line, on the same band as the option beside it. */
const TickCell = styled.span`
  display: flex;
  flex-shrink: 0;
  padding: var(--inset-overlay-band);
  padding-left: 0;
`;

const TickBox = styled.input`
  width: var(--icon-size-control);
  height: var(--icon-size-control);
  margin: 0;
  accent-color: var(--color-accent-fg);
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;

const BadgeContent = styled.span`
  display: inline-flex;
  align-items: center;
  gap: var(--gap-glyph-tray);
`;

const AddBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--gap-control-row);
  padding: var(--inset-overlay-band);
  border-top: 1px solid var(--color-surface-raised);
  flex-shrink: 0;
`;

const ItemTitle = styled.span`
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gap-related);
  min-width: 0;
  margin-right: auto;
`;

const ItemOwner = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-muted);
`;

const OnLayoutMark = styled.span`
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  color: var(--color-go-text);
`;

/* The disc is a little larger than the tick so the tick does not run into the layers glyph behind it. */
const OnLayoutTick = styled.span`
  position: absolute;
  right: -6px;
  bottom: -6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 17px;
  border-radius: var(--radius-circle);
  background: var(--color-surface-panel);
  color: var(--color-go-text);
`;

const ExtenderRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-related);
`;

const ItemName = styled.span`
  font-size: var(--font-size-value);
  font-weight: 600;
  color: var(--color-text-primary);
`;

const ItemDesc = styled.span`
  font-size: var(--font-size-compact);
  color: var(--color-text-faint);
  line-height: var(--line-height-body);
`;

const TagRow = styled.div`
  display: flex;
  gap: var(--gap-related);
  flex-wrap: wrap;
`;

const Empty = styled.div`
  /* Deliberately taller than it is wide: an empty picker needs the vertical
     room to sit where the first result would have been, and every --inset-*
     name puts horizontal at or above vertical, so none of them can say it. */
  padding: var(--inset-overlay-empty);
  font-size: var(--font-size-compact);
  color: var(--color-text-faint);
  text-align: center;
`;
