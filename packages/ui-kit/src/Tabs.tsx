import type { KeyboardEvent, ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import styled from "styled-components";
import { Grid } from "./Grid";
import { Section, SectionTitle } from "./Section";
import { useElementSize } from "./useElementSize";

export interface TabDescriptor {
  /**
   * Stable identity for the tab. Falls back to the tab's position in the
   * array when omitted, so a caller can hand in bare `{ label, content }`
   * pairs and never think about ids.
   */
  id?: string;
  label: string;
  content: ReactNode;
  /**
   * When true, an attention dot is shown beside the tab label, used to
   * point the operator at a tab whose subsystem needs attention (e.g. an
   * offline data source). Aggregating these across tabs is the caller's job.
   */
  indicator?: boolean;
}

export interface TabsProps {
  tabs: TabDescriptor[];
  /**
   * Controlled selection. Omit together with `onChange` to let `Tabs` track
   * its own selection internally, starting on the first tab.
   */
  activeId?: string;
  onChange?: (id: string) => void;
  /**
   * Lay every panel out side by side, each still under its own label, once
   * the container measures wide enough to give each one a legible column;
   * collapses back to single-panel switch mode (a tablist plus one visible
   * panel) below that width. Default `false`: a tab strip is often the
   * better read even with room to spare (content meant to be consumed one
   * section at a time), so this is an opt-in per instance.
   */
  expandWhenRoomy?: boolean;
  className?: string;
}

/** Minimum width a side-by-side panel needs to stay legible. */
export const TABS_PANEL_MIN_WIDTH = 240;

/**
 * Gap between side-by-side panels. Matches `Grid`'s `md` space token (8px)
 * as a literal, so the pure width check below needs no theme context.
 */
const TABS_PANEL_GAP = 8;

/**
 * Pure decision backing `expandWhenRoomy`: true once the measured container
 * can fit every panel at its minimum legible width, side by side. A single
 * tab never expands, there is nothing to lay out beside it.
 */
export function shouldExpandTabs(
  containerWidth: number,
  panelCount: number,
): boolean {
  if (containerWidth <= 0 || panelCount < 2) return false;
  const needed =
    panelCount * TABS_PANEL_MIN_WIDTH + (panelCount - 1) * TABS_PANEL_GAP;
  return containerWidth >= needed;
}

export function Tabs({
  tabs,
  activeId,
  onChange,
  expandWhenRoomy = false,
  className,
}: Readonly<TabsProps>) {
  const uid = useId();
  const resolved = useMemo(
    () => tabs.map((t, i) => ({ ...t, id: t.id ?? `tab-${i}` })),
    [tabs],
  );

  const isControlled = activeId !== undefined;
  const [internalActiveId, setInternalActiveId] = useState(
    () => activeId ?? resolved[0]?.id ?? "",
  );
  const currentId = isControlled ? (activeId as string) : internalActiveId;
  const active = resolved.find((t) => t.id === currentId) ?? resolved[0];

  const select = useCallback(
    (id: string) => {
      if (!isControlled) setInternalActiveId(id);
      onChange?.(id);
    },
    [isControlled, onChange],
  );

  const { ref: sizeRef, size } = useElementSize<HTMLDivElement>({ w: 0, h: 0 });
  const expanded = expandWhenRoomy && shouldExpandTabs(size.w, resolved.length);

  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const barRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  // `expanded` isn't read in the body below, but toggling it swaps the tab
  // bar out of the tree entirely (the side-by-side layout has no bar to
  // scroll); re-running the effect on that flip is what lets it re-attach to
  // a freshly mounted bar when it collapses back, rather than holding a
  // stale ref to a detached node.
  // biome-ignore lint/correctness/useExhaustiveDependencies: expanded is an intentional recompute trigger, see the comment above.
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
  }, [expanded]);

  const activateByIndex = useCallback(
    (idx: number) => {
      const clamped =
        ((idx % resolved.length) + resolved.length) % resolved.length;
      const next = resolved[clamped];
      if (!next) return;
      select(next.id);
      buttonRefs.current.get(next.id)?.focus();
    },
    [resolved, select],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      const currentIdx = resolved.findIndex((t) => t.id === active?.id);
      if (currentIdx < 0) return;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
          e.preventDefault();
          activateByIndex(currentIdx + 1);
          break;
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          activateByIndex(currentIdx - 1);
          break;
        case "Home":
          e.preventDefault();
          activateByIndex(0);
          break;
        case "End":
          e.preventDefault();
          activateByIndex(resolved.length - 1);
          break;
      }
    },
    [resolved, active?.id, activateByIndex],
  );

  if (expanded) {
    return (
      <Tabs__Root ref={sizeRef} data-tabs-root="" className={className}>
        <Grid minColWidth={`${TABS_PANEL_MIN_WIDTH}px`} align="start" gap="md">
          {resolved.map((tab) => (
            <Section key={tab.id}>
              <SectionTitle as="h3" $rule>
                {tab.label}
                {tab.indicator && <Tabs__Dot aria-hidden="true" />}
              </SectionTitle>
              {tab.content}
            </Section>
          ))}
        </Grid>
      </Tabs__Root>
    );
  }

  return (
    <Tabs__Root ref={sizeRef} data-tabs-root="" className={className}>
      <Tabs__BarShell>
        <Tabs__Bar ref={barRef} role="tablist">
          {resolved.map((tab) => {
            const isActive = tab.id === active?.id;
            return (
              <Tabs__Button
                key={tab.id}
                ref={(el) => {
                  if (el) buttonRefs.current.set(tab.id, el);
                  else buttonRefs.current.delete(tab.id);
                }}
                role="tab"
                type="button"
                id={`${uid}${tab.id}-tab`}
                aria-selected={isActive}
                aria-controls={`${uid}${tab.id}-panel`}
                tabIndex={isActive ? 0 : -1}
                $active={isActive}
                onClick={() => select(tab.id)}
                onKeyDown={handleKeyDown}
              >
                {tab.label}
                {tab.indicator && <Tabs__Dot aria-hidden="true" />}
              </Tabs__Button>
            );
          })}
        </Tabs__Bar>
        <Tabs__OverflowGlow $position="left" $visible={overflow.left} />
        <Tabs__OverflowGlow $position="right" $visible={overflow.right} />
      </Tabs__BarShell>
      {active && (
        <Tabs__Panel
          role="tabpanel"
          id={`${uid}${active.id}-panel`}
          aria-labelledby={`${uid}${active.id}-tab`}
        >
          {active.content}
        </Tabs__Panel>
      )}
    </Tabs__Root>
  );
}

const Tabs__Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--space-12);
  /* Fill the panel and constrain children so an active tab whose content
     uses flex:1 can actually scroll. No-op if the parent isn't a flex
     column. */
  flex: 1;
  min-height: 0;
`;

/* Positioned wrapper so the left/right overflow glows can sit over the tab
   bar's edges. The bottom border lives here (not on the scrolling element) so
   it spans the full width even while the tabs scroll underneath it. */
const Tabs__BarShell = styled.div`
  position: relative;
  border-bottom: 1px solid var(--color-border-subtle);
`;

const Tabs__Bar = styled.div`
  display: flex;
  gap: var(--space-2);
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

const Tabs__OverflowGlow = styled.div<{
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
  transition: opacity var(--duration-base) var(--ease-standard);
  background: linear-gradient(
    to ${({ $position }) => ($position === "left" ? "right" : "left")},
    rgba(255, 255, 255, 0.12),
    rgba(255, 255, 255, 0) 100%
  );
  /* Local sibling ordering inside Tabs__BarShell only. Off the app-global z
     ladder on purpose. */
  z-index: 1;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

const Tabs__Dot = styled.span`
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-left: var(--space-6);
  vertical-align: middle;
  border-radius: var(--radius-circle);
  background: var(--color-status-warning-bg);
`;

const Tabs__Button = styled.button<{ $active: boolean }>`
  background: ${({ $active }) =>
    $active ? "var(--color-surface-raised)" : "transparent"};
  border: none;
  /* Keep every tab on one line and let the bar scroll rather than wrap. */
  flex: 0 0 auto;
  white-space: nowrap;
  color: ${({ $active }) =>
    $active ? "var(--color-text-primary)" : "var(--color-text-faint)"};
  cursor: pointer;
  font-size: var(--font-size-sm);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: var(--space-6) var(--space-12);
  border-bottom: 2px solid
    ${({ $active }) => ($active ? "var(--color-accent-fg)" : "transparent")};
  /* Cancels Tabs__BarShell's 1px bottom border so the active tab's indicator
     sits on top of the rule rather than below it. Locked to a border width,
     so it stays off the spacing ladder. */
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
    padding: var(--space-8) var(--space-16);
  }
`;

const Tabs__Panel = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
`;
