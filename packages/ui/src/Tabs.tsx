import type { KeyboardEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";

export interface TabDescriptor {
  id: string;
  label: string;
  content: ReactNode;
  /**
   * When true, an attention dot is shown beside the tab label — used to
   * point the operator at a tab whose subsystem needs attention (e.g. an
   * offline data source). Aggregating these across tabs is the caller's job.
   */
  indicator?: boolean;
}

export interface TabsProps {
  tabs: TabDescriptor[];
  activeId: string;
  onChange: (id: string) => void;
}

export function Tabs({ tabs, activeId, onChange }: Readonly<TabsProps>) {
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const barRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;

    const update = () => {
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setOverflow((prev) =>
        prev.left === left && prev.right === right ? prev : { left, right },
      );
    };

    update();
    el.addEventListener("scroll", update, { passive: true });

    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of Array.from(el.children)) {
      ro.observe(child);
    }

    const mo = new MutationObserver(() => {
      for (const child of Array.from(el.children)) {
        ro.observe(child);
      }
      update();
    });
    mo.observe(el, { childList: true });

    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

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
      <TabBarShell>
        <TabBar ref={barRef} role="tablist">
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
                {tab.indicator && <TabDot aria-hidden="true" />}
              </TabButton>
            );
          })}
        </TabBar>
        <TabBarOverflowGlow $position="left" $visible={overflow.left} />
        <TabBarOverflowGlow $position="right" $visible={overflow.right} />
      </TabBarShell>
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

/* Positioned wrapper so the left/right overflow glows can sit over the tab
   bar's edges. The bottom border lives here (not on the scrolling element) so
   it spans the full width even while the tabs scroll underneath it. */
const TabBarShell = styled.div`
  position: relative;
  border-bottom: 1px solid var(--color-border-subtle);
`;

const TabBar = styled.div`
  display: flex;
  gap: 2px;
  /* Single line: tabs never wrap; the bar scrolls horizontally instead. */
  flex-wrap: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
  /* Hide the native scrollbar: the edge glows communicate scroll state.
     Trackpads/wheels still scroll; keyboard arrows move between tabs. */
  scrollbar-width: none;
  -ms-overflow-style: none;
  &::-webkit-scrollbar {
    width: 0;
    height: 0;
    display: none;
  }
`;

const TabBarOverflowGlow = styled.div<{
  $position: "left" | "right";
  $visible: boolean;
}>`
  position: absolute;
  top: 0;
  bottom: 0;
  ${({ $position }) => ($position === "left" ? "left: 0;" : "right: 0;")}
  width: 28px;
  pointer-events: none;
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  transition: opacity 150ms ease;
  /* Dim white hue brightest at the overflown edge, tapering inward. */
  background: linear-gradient(
    to ${({ $position }) => ($position === "left" ? "right" : "left")},
    rgba(255, 255, 255, 0.12),
    rgba(255, 255, 255, 0) 100%
  );
  z-index: 1;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

const TabDot = styled.span`
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-left: 6px;
  vertical-align: middle;
  border-radius: 50%;
  background: var(--color-status-warning-bg);
`;

const TabButton = styled.button<{ $active: boolean }>`
  background: ${({ $active }) => ($active ? "var(--color-surface-raised)" : "transparent")};
  border: none;
  /* Keep every tab on one line and let the bar scroll rather than wrap. */
  flex: 0 0 auto;
  white-space: nowrap;
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
