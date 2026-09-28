import type { KeyboardEvent, ReactNode } from "react";
import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styled from "styled-components";
import { focusRingInset } from "./focusRing";
import { Grid } from "./Grid";
import { InlineOverflowGlow, useInlineOverflow } from "./inlineOverflow";
import { Section, SectionTitle } from "./Section";
import { useElementSize } from "./useElementSize";
import { VisuallyHidden } from "./VisuallyHidden";

export interface TabDescriptor {
  /** Stable identity for the tab. Falls back to the tab's position in the array. */
  id?: string;
  label: string;
  content: ReactNode;
  /** Shows an attention dot beside the label, for a tab whose subsystem needs attention. */
  indicator?: boolean;
  /**
   * The tab's subsystem does not apply right now (nothing flying, no target).
   * It cannot be selected, roving navigation steps over it, and an active tab
   * that turns off falls through to the first tab that still applies. Prefer it
   * to an empty or dimmed panel.
   */
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabDescriptor[];
  /** Controlled selection. Omit with `onChange` for internal selection starting on the first tab. */
  activeId?: string;
  onChange?: (id: string) => void;
  /**
   * Lay every panel out side by side, each under its own label, once the
   * container is wide enough for a legible column each; below that, a tablist
   * and one panel. Opt-in, default `false`.
   */
  expandWhenRoomy?: boolean;
  /**
   * Accessible name for the tab strip itself, needed once a screen has more
   * than one. Ignored by the side-by-side layout, which has no strip.
   */
  "aria-label"?: string;
  /** As `aria-label`, when the name is already on screen as an element. */
  "aria-labelledby"?: string;
  className?: string;
}

/** Minimum width a side-by-side panel needs to stay legible. */
export const TABS_PANEL_MIN_WIDTH = 240;

/** Gap between side-by-side panels: `Grid`'s `md` token as a literal, so the width check needs no theme. */
const TABS_PANEL_GAP = 8;

/** True once the container fits every panel side by side at its minimum legible width. A single tab never expands. */
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
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
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
  // A disabled tab is never the one on screen, even when named; if every tab is disabled, the caller's choice stands.
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

  // Side-by-side mode measures and renders only the tabs that apply.
  const selectable = useMemo(
    () => resolved.filter((t) => !t.disabled),
    [resolved],
  );

  const { ref: sizeRef, size } = useElementSize<HTMLDivElement>({ w: 0, h: 0 });
  const expanded =
    expandWhenRoomy && shouldExpandTabs(size.w, selectable.length);

  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const barRef = useRef<HTMLDivElement | null>(null);
  /*
   * Tighter padding and tracking once the tabs stop fitting, decided against the
   * row's uncompacted width. It is cached, and only written while uncompacted,
   * because re-reading it while compacted would oscillate.
   */
  const naturalWidthRef = useRef<number | null>(null);
  const [compact, setCompact] = useState(false);
  // State as well as a ref: `expanded` swaps the strip in and out of the tree, and the overflow watch must follow it.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  /*
   * Memoized so its identity is stable across renders. An inline ref callback
   * is a new function every render, and React detaches then reattaches a ref
   * whose identity changed, so an inline callback that calls a state setter
   * fires that setter on every render it causes, which is the render it just
   * caused: an infinite loop, React error #185.
   */
  const scrollerRef = useCallback((el: HTMLDivElement | null) => {
    barRef.current = el;
    setScroller(el);
  }, []);
  const overflow = useInlineOverflow(scroller);
  // Measured, since labels differ in width and the blob must land exactly on the active one.
  const [blob, setBlob] = useState<{ left: number; width: number } | null>(
    null,
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the tab SET changes, since that is what changes the natural width.
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const measure = () => {
      // Recorded on every uncompacted pass, so a font swap is picked up too.
      setCompact((wasCompact) => {
        if (!wasCompact) naturalWidthRef.current = bar.scrollWidth;
        const natural = naturalWidthRef.current;
        return natural == null ? false : natural > bar.clientWidth;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [expanded, resolved.length]);

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
      // offsetLeft is relative to the track, which scrolls with the tabs, so the blob does too.
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

  /**
   * Move `step` tabs from `from`, wrapping, and keep going while the landing
   * tab is disabled. Bounded by the tab count, so a set with nothing
   * selectable does not move.
   */
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
        // Home/End start one step outside the strip, so the search lands on the end tab and walks inward past disabled ones.
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
        <Grid
          minColWidth={`${TABS_PANEL_MIN_WIDTH}px`}
          align="start"
          gap="related-comfortable"
        >
          {selectable.map((tab) => (
            <Section key={tab.id}>
              <SectionTitle as="h3" $rule>
                {tab.label}
                {tab.indicator && (
                  <>
                    <Tabs__Dot aria-hidden="true" />
                    <VisuallyHidden>, needs attention</VisuallyHidden>
                  </>
                )}
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
        <Tabs__Scroller ref={scrollerRef}>
          <Tabs__Bar
            role="tablist"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
          >
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
                  aria-describedby={
                    tab.indicator ? `${uid}${tab.id}-attention` : undefined
                  }
                  tabIndex={isActive ? 0 : -1}
                  disabled={tab.disabled}
                  $active={isActive}
                  onClick={() => select(tab.id)}
                  onKeyDown={handleKeyDown}
                  title={tab.label}
                  $compact={compact}
                >
                  {tab.label}
                  {tab.indicator && (
                    <>
                      <Tabs__Dot aria-hidden="true" />
                      <span id={`${uid}${tab.id}-attention`} hidden>
                        Needs attention
                      </span>
                    </>
                  )}
                </Tabs__Button>
              );
            })}
          </Tabs__Bar>
        </Tabs__Scroller>
        <InlineOverflowGlow $position="left" $visible={overflow.left} />
        <InlineOverflowGlow $position="right" $visible={overflow.right} />
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
  gap: var(--gap-tabs-panel);
  /* Fills the panel and constrains children, so a flex:1 tab body can scroll. */
  flex: 1;
  min-height: 0;
`;

/*
 * Positioned wrapper so the overflow glows can sit over the strip's edges. It
 * reaches out to the panel's edges, so tabs scrolled out of view pass under a
 * glow sitting in the panel's gutter rather than being cut off at its padding.
 */
const Tabs__BarShell = styled.div`
  position: relative;
  margin-inline: calc(-1 * var(--bleed-inline));
`;

/* The scrolling strip. Its inline padding puts the track back on the content column while it rests. */
const Tabs__Scroller = styled.div`
  display: flex;
  padding-inline: var(--bleed-inline);
  overflow-x: auto;
  overflow-y: hidden;
  /* Native scrollbar hidden: the edge glows show scroll state. */
  scrollbar-width: none;
  -ms-overflow-style: none;
  &::-webkit-scrollbar {
    width: 0;
    height: 0;
    display: none;
  }
`;

// The track holding every tab; the blob measures and travels inside it.
const Tabs__Bar = styled.div`
  position: relative;
  flex: 1 0 auto;
  display: flex;
  gap: var(--gap-tab);
  background: var(--color-surface-sunken);
  border-radius: var(--radius-pill);
  padding: var(--inset-tab-track);
  flex-wrap: nowrap;
`;

// The selection blob. The buttons are `position: relative`, so DOM order alone puts the labels over it.
const Tabs__Blob = styled.span`
  position: absolute;
  top: var(--inset-tab-track);
  bottom: var(--inset-tab-track);
  border-radius: var(--radius-pill);
  background: var(--color-accent-bg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  transition:
    left var(--duration-base) var(--ease-standard),
    width var(--duration-base) var(--ease-standard);

  /* With motion damped the blob simply appears on the new tab. */
  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

const Tabs__Dot = styled.span`
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-left: var(--gap-trailing-mark);
  vertical-align: middle;
  border-radius: var(--radius-circle);
  background: var(--color-warn-mark);
`;

const Tabs__Button = styled.button<{
  $active: boolean;
  $compact?: boolean;
}>`
  /* Transparent: the blob behind it is the selected background. */
  background: transparent;
  border: none;
  /* Lifts the label over the blob by DOM order, no z-index involved. */
  position: relative;
  /* Tabs never shrink: a short label losing its word is worse than a long one continuing offscreen behind the overflow glow. */
  flex: 0 0 auto;
  white-space: nowrap;
  /* Inverts on the accent blob, where primary text fails contrast. */
  color: ${({ $active }) =>
    $active ? "var(--color-text-inverse)" : "var(--color-text-faint)"};
  cursor: pointer;
  font-size: var(--font-size-compact);
  font-weight: 700;
  text-transform: uppercase;
  border-radius: var(--radius-pill);
  /* Compact gives back the inset and tracking, never the label. Plain concatenation: a nested template literal breaks the parse. */
  ${({ $compact }) =>
    $compact
      ? "padding: var(--inset-tab-compact);" + "letter-spacing: 0.04em;"
      : "padding: var(--inset-control);" + "letter-spacing: 0.12em;"}
  /* The label gives under the press, the only feedback a tab gets on touch. */
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

  /* Present but inert: legible enough to say what is missing, and the cursor says it will not respond. */
  &:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }

  ${focusRingInset}

  @media (pointer: coarse) {
    min-height: 44px;
    /* Compact still applies on touch: a tab scrolled half out of view is a smaller target, not a bigger one. */
    ${({ $compact }) =>
      $compact
        ? "padding: var(--inset-tab-compact-touch);"
        : "padding: var(--inset-control-touch);"}
  }
`;

const Tabs__Panel = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
`;
