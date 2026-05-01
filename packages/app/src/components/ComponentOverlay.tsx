import type { ComponentDefinition } from "@gonogo/core";
import { getComponents } from "@gonogo/core";
import { CpuRegistryProvider, useCpuRegistryService } from "@gonogo/data";
import { SerialDeviceProvider, useSerialDeviceService } from "@gonogo/serial";
import { Tag, useFabCluster, useModal } from "@gonogo/ui";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import styled from "styled-components";
import type { DashboardItem } from "./Dashboard";

// ---------------------------------------------------------------------------
// Context — lets the overlay call addItem without prop-drilling
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

  const { addItem, updateItemConfig } = useOverlay();
  const { open: openModal, close: closeModal } = useModal();
  // ModalProvider lives at the app root, above SerialDeviceProvider. Config
  // components opened here via `openConfigOnAdd` portal out of the provider
  // subtree, so we capture the services screen-side and re-provide them
  // inside the modal content. Same pattern as the dashboard's GearButton.
  // Any new context the kOS widgets reach for (KosCpuPicker → registry,
  // future kOS proxy etc.) needs the same treatment here.
  const serialService = useSerialDeviceService();
  const cpuRegistry = useCpuRegistryService();

  const allComponents = getComponents();

  const filtered = query.trim()
    ? allComponents.filter((def) => {
        const q = query.toLowerCase();
        return (
          def.name.toLowerCase().includes(q) ||
          def.tags.some((t) => t.toLowerCase().includes(q))
        );
      })
    : allComponents;

  const nextY = useCallback(() => {
    const items = currentLayouts.lg ?? [];
    if (items.length === 0) return 0;
    return Math.max(...items.map((l) => l.y + l.h));
  }, [currentLayouts]);

  const handleSelect = useCallback(
    (def: ComponentDefinition) => {
      const item: DashboardItem = {
        i: crypto.randomUUID(),
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
      setOpen(false);
      setQuery("");

      if (def.openConfigOnAdd && def.configComponent) {
        const ConfigComp = def.configComponent;
        const modalId = openModal(
          <SerialDeviceProvider service={serialService}>
            <CpuRegistryProvider service={cpuRegistry}>
              <ConfigComp
                config={item.config ?? def.defaultConfig ?? {}}
                onSave={(newConfig: Record<string, unknown>) => {
                  // Persist the user's freshly-entered config to the item
                  // that addItem just placed. Without this, the on-add modal
                  // was cosmetic — the widget reverted to defaultConfig.
                  updateItemConfig(item.i, newConfig);
                  closeModal(modalId);
                }}
              />
            </CpuRegistryProvider>
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
      serialService,
      cpuRegistry,
    ],
  );

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
        <Backdrop
          onClick={() => {
            setOpen(false);
            setQuery("");
          }}
        >
          <Panel
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Add a component"
          >
            <PanelHeader>
              <PanelTitle>ADD COMPONENT</PanelTitle>
              <CloseBtn
                onClick={() => {
                  setOpen(false);
                  setQuery("");
                }}
                aria-label="Close"
              >
                ✕
              </CloseBtn>
            </PanelHeader>
            <SearchInput
              autoFocus
              placeholder="Search by name or tag…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setOpen(false);
                  setQuery("");
                }
              }}
            />
            <List>
              {filtered.length === 0 && (
                <Empty>No components match "{query}"</Empty>
              )}
              {filtered.map((def) => (
                <ListItem key={def.id} onClick={() => handleSelect(def)}>
                  <ItemName>{def.name}</ItemName>
                  <ItemDesc>{def.description}</ItemDesc>
                  <TagRow>
                    {def.tags.map((t) => (
                      <Tag key={t} label={t} />
                    ))}
                  </TagRow>
                </ListItem>
              ))}
            </List>
          </Panel>
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
  bottom: 24px;
  right: 24px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--color-accent-fg);
  border: none;
  color: var(--color-text-inverse);
  font-size: 28px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(0, 204, 102, 0.3);
  z-index: 900;
  transition:
    background 0.15s,
    transform 0.1s;

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
  z-index: 950;
`;

const Panel = styled.div`
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  width: 480px;
  max-width: 95vw;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.7);
  overflow: hidden;
`;

const PanelHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--color-surface-raised);
  flex-shrink: 0;
`;

const PanelTitle = styled.h2`
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  color: var(--color-text-faint);
  text-transform: uppercase;
`;

const CloseBtn = styled.button`
  background: none;
  border: none;
  color: var(--color-text-faint);
  font-size: 14px;
  cursor: pointer;
  padding: 2px 4px;
  &:hover {
    color: var(--color-text-primary);
  }
`;

const SearchInput = styled.input`
  background: var(--color-surface-panel);
  border: none;
  border-bottom: 1px solid var(--color-surface-raised);
  color: var(--color-text-primary);
  font-size: 13px;
  padding: 10px 16px;
  flex-shrink: 0;

  &:focus {
    outline: none;
    border-bottom-color: var(--color-accent-fg);
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: -2px;
  }

  &::placeholder {
    color: var(--color-border-strong);
  }
`;

const List = styled.div`
  overflow-y: auto;
  flex: 1;
`;

const ListItem = styled.button`
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-bottom: 1px solid var(--color-surface-panel);
  padding: 12px 16px;
  cursor: pointer;

  &:hover {
    background: var(--color-surface-raised);
  }
  &:last-child {
    border-bottom: none;
  }
`;

const ItemName = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
`;

const ItemDesc = styled.span`
  font-size: 11px;
  color: var(--color-text-faint);
  line-height: 1.4;
`;

const TagRow = styled.div`
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
`;

const Empty = styled.div`
  padding: 24px 16px;
  font-size: 12px;
  color: var(--color-text-faint);
  text-align: center;
`;
