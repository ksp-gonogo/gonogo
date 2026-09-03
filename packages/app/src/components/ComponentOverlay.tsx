import { availableAtSeat } from "@ksp-gonogo/components";
import type { ComponentDefinition } from "@ksp-gonogo/core";
import {
  effectiveSearchTags,
  getComponents,
  safeRandomUuid,
  uplinkAdditions,
  useChromeWrap,
  useSeat,
} from "@ksp-gonogo/core";
import {
  SerialDeviceProvider,
  useSerialDeviceService,
} from "@ksp-gonogo/serial";
import {
  CloseIcon,
  FilterChip,
  Tag,
  useFabCluster,
  useModal,
} from "@ksp-gonogo/ui";
import { Box } from "@ksp-gonogo/ui-kit";
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

// ---------------------------------------------------------------------------
// Context: lets the overlay call addItem without prop-drilling
// ---------------------------------------------------------------------------

interface OverlayContextValue {
  addItem: (
    item: DashboardItem,
    layout: { x: number; y: number; w: number; h: number },
  ) => void;
  updateItemConfig: (id: string, config: Record<string, unknown>) => void;
}

const OverlayContext = createContext<OverlayContextValue | null>(null);

export function OverlayProvider({
  children,
  addItem,
  updateItemConfig,
}: Readonly<{
  children: ReactNode;
  addItem: (
    item: DashboardItem,
    layout: { x: number; y: number; w: number; h: number },
  ) => void;
  updateItemConfig: (id: string, config: Record<string, unknown>) => void;
}>) {
  const value = useMemo(
    () => ({ addItem, updateItemConfig }),
    [addItem, updateItemConfig],
  );
  return (
    <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>
  );
}

function useOverlay(): OverlayContextValue {
  const ctx = useContext(OverlayContext);
  if (!ctx) throw new Error("useOverlay must be used inside <OverlayProvider>");
  return ctx;
}

// ---------------------------------------------------------------------------
// FAB + Overlay
// ---------------------------------------------------------------------------

interface ComponentOverlayProps {
  /** Current items so we can compute the next free y position. */
  currentLayouts: { lg?: Array<{ y: number; h: number }> };
}

export function ComponentOverlay({
  currentLayouts,
}: Readonly<ComponentOverlayProps>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(
    () => new Set(),
  );
  // Roving selection cursor for keyboard navigation of the results list. The
  // search input keeps DOM focus (combobox pattern) and the active option is
  // tracked via aria-activedescendant, so the user can keep typing to filter
  // while arrows move the highlight.
  const [activeIdx, setActiveIdx] = useState(0);
  const activeOptionRef = useRef<HTMLButtonElement | null>(null);

  const { addItem, updateItemConfig } = useOverlay();
  const { open: openModal, close: closeModal } = useModal();
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

  // Tag → count, descending. Drives the chip row below the search box so the
  // most-used tags appear first. Singleton tags (only one widget carries
  // them) are hidden, user feedback (2026-05-12): the chip row was dense
  // with chips that filtered to a single result, and they pushed the
  // useful filters off the screen.
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
      // The COSMETIC half of the seat rule: this stops a ground instrument
      // being offered here, and `SeatGuard` in the orchestrator is what stops
      // it rendering when one arrives by any of the other paths that put an
      // item in `items[]` (mission-profile replace, scene auto-switch, backup
      // restore, raw localStorage, peer widget-push).
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
    setActiveIdx(0);
  }, []);

  const nextY = useCallback(() => {
    const items = currentLayouts.lg ?? [];
    if (items.length === 0) return 0;
    return Math.max(...items.map((l) => l.y + l.h));
  }, [currentLayouts]);

  const handleSelect = useCallback(
    (def: ComponentDefinition) => {
      const item: DashboardItem = {
        i: safeRandomUuid(),
        componentId: def.id,
        config: def.defaultConfig ? { ...def.defaultConfig } : undefined,
      };
      const defaultSize = def.defaultSize ?? { w: 3, h: 3 };
      const min = def.minSize;
      const size = min
        ? {
            w: Math.max(defaultSize.w, min.w),
            h: Math.max(defaultSize.h, min.h),
          }
        : defaultSize;
      const layout = { x: 0, y: nextY(), ...size };

      addItem(item, layout);
      closeOverlay();

      if (def.openConfigOnAdd && def.configComponent) {
        const ConfigComp = def.configComponent;
        const modalId = openModal(
          <SerialDeviceProvider service={serialService}>
            {wrapChrome(
              <ConfigComp
                config={item.config ?? def.defaultConfig ?? {}}
                onSave={(newConfig: Record<string, unknown>) => {
                  // Persist the user's freshly-entered config to the item
                  // that addItem just placed. Without this, the on-add modal
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
      addItem,
      updateItemConfig,
      nextY,
      openModal,
      closeModal,
      closeOverlay,
      serialService,
      wrapChrome,
    ],
  );

  // Combobox keyboard nav: arrows move the roving selection through the
  // filtered results, Enter activates the highlighted widget. Clamps at the
  // ends (APG-consistent for a search-filtered listbox: wrapping is jarring
  // when you're scanning a list you filtered yourself). Escape still closes.
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
        if (def) handleSelect(def);
      }
    },
    [filtered, activeIdx, handleSelect, closeOverlay],
  );

  const listboxId = "component-overlay-listbox";
  const optionId = (id: string) => `component-overlay-option-${id}`;
  const activeDef = filtered[activeIdx];

  const cluster = useFabCluster();

  return (
    <>
      <FAB
        onClick={() => setOpen(true)}
        onMouseEnter={cluster?.onMouseEnter}
        onMouseLeave={cluster?.onMouseLeave}
        onFocus={cluster?.onFocus}
        onBlur={cluster?.onBlur}
        aria-label="Add component"
        title="Add component"
      >
        +
      </FAB>

      {open && (
        <Backdrop onClick={closeOverlay}>
          <OverlaySurface
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Add a component"
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
            <List id={listboxId} role="listbox" aria-label="Available widgets">
              {filtered.length === 0 && (
                <Empty>
                  No widgets match "{query}"
                  {selectedTags.size > 0 && " in selected tags"}
                </Empty>
              )}
              {filtered.map((def, i) => {
                const active = i === activeIdx;
                return (
                  <ListItem
                    key={def.id}
                    id={optionId(def.id)}
                    role="option"
                    aria-selected={active}
                    $active={active}
                    ref={active ? activeOptionRef : undefined}
                    // Pointer focus moves the roving cursor so a subsequent
                    // keystroke continues from where the mouse last hovered.
                    onMouseEnter={() => setActiveIdx(i)}
                    onClick={() => handleSelect(def)}
                  >
                    <ItemName>{def.name}</ItemName>
                    <ItemDesc>{def.description}</ItemDesc>
                    {uplinkAdditions(def).map((u) => (
                      <UplinkAddLine key={u.id}>+ {u.name}</UplinkAddLine>
                    ))}
                    <TagRow>
                      {def.tags.map((t) => (
                        <Tag key={t} label={t} />
                      ))}
                    </TagRow>
                  </ListItem>
                );
              })}
            </List>
          </OverlaySurface>
        </Backdrop>
      )}
    </>
  );
}

export { useOverlay };

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const FAB = styled.button`
  position: fixed;
  /* Held literal with the rest of the FAB-geometry chain in @ksp-gonogo/ui:
     this is the primary "+" button BannerStack's right: 88px (24 + 48 + 16),
     FabPrompt's 72px and Fab's own right: 24px are all arithmetic on. Those
     stay literal because a CSS pass cannot see the derived numbers, so
     tokenising only this end would desynchronise the cluster the first time
     --space-24 moves. Do not add a safe-area wrapper here in isolation
     either: it shifts this button relative to nothing else. */
  bottom: 24px;
  right: 24px;
  width: 48px;
  height: 48px;
  border-radius: var(--radius-circle);
  background: var(--color-accent-fg);
  border: none;
  color: var(--color-text-inverse);
  /* Display tier: above --font-size-lg, which the scale stops at on purpose. */
  font-size: 28px;
  line-height: var(--line-height-flush);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(0, 204, 102, 0.3);
  z-index: var(--z-fab);
  /* Multi-line on purpose and on two different rungs: 0.15s is --duration-base
     exactly, 0.1s snaps up to --duration-fast (+20ms). A line-oriented pass
     rewrites one and leaves the other. */
  transition:
    background var(--duration-base),
    transform var(--duration-fast);

  &:hover {
    background: var(--color-accent-bg);
    transform: scale(1.05);
  }
  &:active {
    transform: scale(0.97);
  }
`;

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
// this overlay's. lg was the missing radius that kept this hand-rolled.
const OverlaySurface = styled(Box).attrs({
  surface: "panel" as const,
  bordered: true,
  radius: "lg" as const,
})`
  width: 560px;
  max-width: 95vw;
  /* Spotlight-style stable height: regardless of how many results match,
     the panel is the same size. Filtering narrows the list inside, never
     resizes the wrapper. */
  height: min(640px, 80vh);
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.7);
  overflow: hidden;
`;

const SearchRow = styled.div`
  display: flex;
  align-items: center;
  gap: var(--space-8);
  /* Horizontal inset goes UP to the panel column, not down to --space-12 that
     14px maps to: ResultsHeader, ChipRow and ListItem below all sit at
     --space-16, so 14px is already 2px off that edge and snapping down would
     double the misalignment on the widest edge of the picker. */
  padding: var(--space-12) var(--space-16);
  border-bottom: 1px solid var(--color-surface-raised);
  flex-shrink: 0;
`;

const CloseBtn = styled.button`
  background: none;
  border: none;
  color: var(--color-text-faint);
  font-size: var(--font-size-base);
  cursor: pointer;
  padding: var(--space-4) var(--space-6);
  border-radius: var(--radius-xs);
  &:hover {
    color: var(--color-text-primary);
    background: var(--color-surface-raised);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
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
  padding: var(--space-4) 0;

  &:focus {
    outline: none;
  }

  &::placeholder {
    color: var(--color-text-faint);
  }
`;

const ResultsHeader = styled.div`
  padding: var(--space-6) var(--space-16);
  font-size: var(--font-size-2xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  flex-shrink: 0;
`;

const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-6);
  padding: var(--space-10) var(--space-16);
  border-bottom: 1px solid var(--color-surface-raised);
  flex-shrink: 0;
`;

const List = styled.div`
  overflow-y: auto;
  flex: 1;
`;

const ListItem = styled.button<{ $active?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  width: 100%;
  text-align: left;
  background: ${(p) => (p.$active ? "var(--color-surface-raised)" : "none")};
  border: none;
  border-bottom: 1px solid var(--color-surface-panel);
  padding: var(--space-12) var(--space-16);
  cursor: pointer;
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
  &:focus-visible {
    /* Inset ring: the ancestor is overflow: hidden, so a positive offset
       would clip it away entirely. Ring geometry, never a spacing rung. */
    outline: 2px solid var(--color-accent-fg);
    outline-offset: -2px;
  }
`;

const ItemName = styled.span`
  font-size: var(--font-size-sm);
  font-weight: 600;
  color: var(--color-text-primary);
`;

const ItemDesc = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-text-faint);
  line-height: var(--line-height-body);
`;

// One line per Uplink that augments or contributes to the widget, making the
// addition explicit next to the base description. Accent-toned so it reads as
// an extension rather than part of the stock description.
const UplinkAddLine = styled.span`
  font-size: var(--font-size-xs);
  color: var(--color-accent-fg);
  line-height: var(--line-height-body);
`;

const TagRow = styled.div`
  display: flex;
  gap: var(--space-4);
  flex-wrap: wrap;
`;

const Empty = styled.div`
  padding: var(--space-24) var(--space-16);
  font-size: var(--font-size-sm);
  color: var(--color-text-faint);
  text-align: center;
`;
