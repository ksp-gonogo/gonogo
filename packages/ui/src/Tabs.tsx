import type { KeyboardEvent, ReactNode } from "react";
import { useCallback, useRef } from "react";
import styled from "styled-components";

export interface TabDescriptor {
  id: string;
  label: string;
  content: ReactNode;
}

export interface TabsProps {
  tabs: TabDescriptor[];
  activeId: string;
  onChange: (id: string) => void;
}

export function Tabs({ tabs, activeId, onChange }: Readonly<TabsProps>) {
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const activateByIndex = useCallback(
    (idx: number) => {
      const clamped = ((idx % tabs.length) + tabs.length) % tabs.length;
      const next = tabs[clamped];
      if (!next) return;
      onChange(next.id);
      buttonRefs.current.get(next.id)?.focus();
    },
    [tabs, onChange],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      const currentIdx = tabs.findIndex((t) => t.id === active?.id);
      if (currentIdx < 0) return;
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          activateByIndex(currentIdx + 1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          activateByIndex(currentIdx - 1);
          break;
        case "Home":
          e.preventDefault();
          activateByIndex(0);
          break;
        case "End":
          e.preventDefault();
          activateByIndex(tabs.length - 1);
          break;
      }
    },
    [tabs, active?.id, activateByIndex],
  );

  return (
    <TabsRoot>
      <TabBar role="tablist">
        {tabs.map((tab) => {
          const isActive = tab.id === active?.id;
          return (
            <TabButton
              key={tab.id}
              ref={(el) => {
                if (el) buttonRefs.current.set(tab.id, el);
                else buttonRefs.current.delete(tab.id);
              }}
              role="tab"
              type="button"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              $active={isActive}
              onClick={() => onChange(tab.id)}
              onKeyDown={handleKeyDown}
            >
              {tab.label}
            </TabButton>
          );
        })}
      </TabBar>
      <TabPanel role="tabpanel">{active?.content}</TabPanel>
    </TabsRoot>
  );
}

const TabsRoot = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  /* Fill the panel and constrain children so an active tab whose content
     uses flex:1 can actually scroll. No-op if the parent isn't a flex
     column. */
  flex: 1;
  min-height: 0;
`;

const TabBar = styled.div`
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--color-border-subtle);
`;

const TabButton = styled.button<{ $active: boolean }>`
  background: ${({ $active }) => ($active ? "var(--color-surface-raised)" : "transparent")};
  border: none;
  color: ${({ $active }) => ($active ? "var(--color-text-primary)" : "var(--color-text-faint)")};
  cursor: pointer;
  font-size: var(--font-size-sm);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 6px 12px;
  border-bottom: 2px solid
    ${({ $active }) => ($active ? "var(--color-accent-fg)" : "transparent")};
  margin-bottom: -1px;

  @media (hover: hover) {
    &:hover {
      color: var(--color-text-primary);
    }
  }

  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: -2px;
  }

  @media (pointer: coarse) {
    min-height: 44px;
    padding: 8px 14px;
  }
`;

const TabPanel = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
`;
