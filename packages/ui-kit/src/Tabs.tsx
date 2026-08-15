import type { KeyboardEvent, ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
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
  /**
   * The tab's subsystem does not apply right now, so there is nothing behind
   * it to read: an active-vessel panel with nothing flying, a per-target view
   * with no target. It cannot be selected by pointer or keyboard, the roving
   * navigation steps over it, and if it is the active tab when it turns off,
   * selection falls through to the first tab that still applies. Reach for it
   * rather than rendering an empty panel or dimming the content, both of which
   * leave the operator to work out why the tab is blank.
   */
  disabled?: boolean;
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
  // A disabled tab is never the one on screen, even when the caller still
  // names it: a panel that cannot be reached by click or key must not be
  // reachable by going stale either. First tab that still applies wins, and
  // the whole set being disabled falls back to the caller's choice rather
  // than rendering nothing.
  const named = resolved.find((t) => t.id === currentId);
  const active =
    named && !named.disabled
      ? named
      : (resolved.find((t) => !t.disabled) ?? named ?? resolved[0]);

  const select = useCallback(
    (id: string) => {
      if (!isControlled) setInternalActiveId(id);
      onChange?.(id);
    },
    [isControlled, onChange],
  );

  // Side-by-side mode lays out panels, and a disabled tab has no panel worth
  // laying out, so it is measured and rendered against the tabs that apply.
  const selectable = useMemo(
    () => resolved.filter((t) => !t.disabled),
    [resolved],
  );

  const { ref: sizeRef, size } = useElementSize<HTMLDivElement>({ w: 0, h: 0 });
  const expanded =
    expandWhenRoomy && shouldExpandTabs(size.w, selectable.length);

  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const barRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  // Where the selection blob sits. Measured rather than derived from flex
  // order: labels are different widths, and the blob has to land exactly on
  // whichever one is active, including after a resize or a font swap.
  const [blob, setBlob] = useState<{ left: number; width: number } | null>(
    null,
  );

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

  /**
   * Move `step` tabs from `from`, wrapping, and keep going while the landing
   * tab is disabled. Bounded by the tab count, so a set with nothing
   * selectable simply does not move rather than spinning.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the active tab or the tab set changes, which is exactly what moves the blob.
  useLayoutEffect(() => {
    const bar = barRef.current;
    const button = active ? buttonRefs.current.get(active.id) : undefined;
    if (!bar || !button) {
      setBlob(null);
      return;
    }
    const measure = () => {
      const el = buttonRefs.current.get(active?.id ?? "");
      if (!el) return;
      // offsetLeft is relative to the scrolling bar's content box, so the blob
      // travels with the tabs when the bar scrolls instead of detaching.
      setBlob((prev) =>
        prev && prev.left === el.offsetLeft && prev.width === el.offsetWidth
          ? prev
          : { left: el.offsetLeft, width: el.offsetWidth },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    ro.observe(button);
    return () => ro.disconnect();
  }, [active?.id, resolved.length, expanded]);

  const activateByIndex = useCallback(
    (from: number, step: number) => {
      const n = resolved.length;
      for (let i = 1; i <= n; i++) {
        const next = resolved[(((from + step * i) % n) + n) % n];
        if (!next || next.disabled) continue;
        select(next.id);
        buttonRefs.current.get(next.id)?.focus();
        return;
      }
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
          activateByIndex(currentIdx, 1);
          break;
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          activateByIndex(currentIdx, -1);
          break;
        // Home/End start one step OUTSIDE the strip so the search lands on the
        // first (or last) tab itself, then walks inward past any disabled ones.
        case "Home":
          e.preventDefault();
          activateByIndex(-1, 1);
          break;
        case "End":
          e.preventDefault();
          activateByIndex(resolved.length, -1);
          break;
      }
    },
    [resolved, active?.id, activateByIndex],
  );

  if (expanded) {
    return (
      <Tabs__Root ref={sizeRef} data-tabs-root="" className={className}>
        <Grid minColWidth={`${TABS_PANEL_MIN_WIDTH}px`} align="start" gap="md">
          {selectable.map((tab) => (
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
          {blob && (
            <Tabs__Blob
              aria-hidden="true"
              style={{ left: blob.left, width: blob.width }}
            />
          )}
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
                disabled={tab.disabled}
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
   bar's edges. The rule the bar used to sit on is gone: the track is the
   boundary now, and a line under it read as a second one. */
const Tabs__BarShell = styled.div`
  position: relative;
`;

/* The track: one dark rounded rectangle holding every tab, so the strip reads
   as a single control rather than a row of loose words. `position: relative`
   is what the blob measures and travels inside. */
const Tabs__Bar = styled.div`
  position: relative;
  display: flex;
  gap: var(--space-2);
  background: var(--color-surface-sunken);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
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

/* The selection blob. Painted before the buttons and left unpositioned in the
   stacking sense: the buttons are `position: relative`, so DOM order alone
   puts the labels over it and no z-index is needed. */
const Tabs__Blob = styled.span`
  position: absolute;
  top: var(--space-4);
  bottom: var(--space-4);
  border-radius: var(--radius-md);
  background: var(--color-surface-raised);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  transition:
    left var(--duration-base) var(--ease-standard),
    width var(--duration-base) var(--ease-standard);

  /* The blob's whole job is to show WHERE selection went; with motion damped
     it simply appears on the new tab. */
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
  /* Transparent throughout: the blob behind it is the selected background, so
     a background here would cover the thing that moves. */
  background: transparent;
  border: none;
  /* Lifts the label over the blob by DOM order, no z-index involved. */
  position: relative;
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
  border-radius: var(--radius-md);
  /* Pushing: the label gives under the press and springs back, which is the
     only feedback a tab gets on a touch device where there is no hover. */
  transition: transform var(--duration-fast) var(--ease-standard);

  &:active:not(:disabled) {
    transform: scale(0.96);
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
    &:active:not(:disabled) {
      transform: none;
    }
  }

  @media (hover: hover) {
    &:hover:not(:disabled) {
      color: var(--color-text-primary);
    }
  }

  /* Reads as present but inert: the label stays legible enough to say what is
     missing, and the cursor says it will not respond. */
  &:disabled {
    cursor: not-allowed;
    opacity: 0.4;
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
