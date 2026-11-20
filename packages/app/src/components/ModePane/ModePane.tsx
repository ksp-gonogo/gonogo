import type {
  ModeDefinition,
  ModeTimeline,
  SectionStatus,
} from "@ksp-gonogo/sitrep-sdk";
import {
  type AnyAugment,
  Badge,
  getAugmentsForSlot,
  LiveRegion,
  onAugmentsChange,
  TONE_MARK,
  useAugmentAvailable,
} from "@ksp-gonogo/ui-kit";
import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import styled from "styled-components";
import { TIMELINE_COMPACT_PX, TIMELINE_HEIGHT_PX, Timeline } from "./Timeline";

type Detent = "peek" | "half" | "full";

/** Below this width the pane is a bottom sheet; at or above it, a side pane. */
const SHEET_BELOW_PX = 641;
const SHEET_QUERY = `(max-width: ${SHEET_BELOW_PX - 1}px)`;
const DETENTS: readonly Detent[] = ["peek", "half", "full"];
const DETENT_KEY = "gonogo.modePane.detent";
const COLLAPSED_KEY = "gonogo.modePane.collapsed";

function readStored<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  try {
    const v = globalThis.localStorage?.getItem(key);
    return allowed.includes(v as T) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // The choice holds for this session only.
  }
}

function useIsSheet(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = globalThis.matchMedia?.(SHEET_QUERY);
      mq?.addEventListener("change", cb);
      return () => mq?.removeEventListener("change", cb);
    },
    () => globalThis.matchMedia?.(SHEET_QUERY).matches ?? false,
    () => false,
  );
}

const NO_TIMELINE = (): ModeTimeline | undefined => undefined;
const EMPTY: AnyAugment[] = [];

/* Each slot's list is memoised until the registry changes, since `useSyncExternalStore` needs a stable snapshot. */
const slotCache = new Map<string, AnyAugment[]>();
onAugmentsChange(() => slotCache.clear());

function useSections(slot: string): AnyAugment[] {
  const read = () => {
    let list = slotCache.get(slot);
    if (!list) {
      list = getAugmentsForSlot(slot);
      slotCache.set(slot, list.length ? list : EMPTY);
    }
    return slotCache.get(slot) ?? EMPTY;
  };
  return useSyncExternalStore(onAugmentsChange, read, read);
}

/**
 * The mode's chrome around the dashboard: its pane, shown while any section is
 * bound to the mode's `mode-sections.<id>` slot, with those sections under one
 * title row, and its Timeline. A mode with neither draws nothing.
 * On a wide screen the pane is docked to the left edge, always open while the
 * mode is on, and the Timeline runs along the bottom beside it as one shape:
 * the mode's rule runs along the pane's top, down its inner side and along the
 * Timeline's top. The dashboard lays out once in the space left, so no tile
 * moves while the mode lasts. On a phone the pane is a bottom sheet over the
 * tiles with the Timeline at its foot; it starts minimised to its title row
 * and the Timeline, and is lifted to half or full height. Mount it keyed by
 * the mode's id, since it calls the mode's own hooks.
 */
export function ModePane({
  mode,
  title,
  subject,
  timelineTrailing,
  notice,
}: {
  mode: ModeDefinition;
  title: string;
  /** What the mode's Timeline plays, in the words its controls name it by. */
  subject?: string;
  /** A control at the end of the Timeline, such as a station's sync switch. */
  timelineTrailing?: ReactNode;
  /** A word on the mode's state that is not a section's, such as that it is waiting for the craft. Drawn under the Timeline's track, which keeps its whole width. */
  notice?: string;
}) {
  // The one place the mode's colour is turned into a colour: every piece of the pane, the Timeline and the arrow read it from here.
  const rule = useMemo(
    () => ({ "--mode-rule": TONE_MARK[mode.tone ?? "info"] }) as CSSProperties,
    [mode.tone],
  );
  const sections = useSections(`mode-sections.${mode.id}`);
  // The pane is there for its sections: a mode with none contributed has no pane.
  const pane = sections.length > 0;
  const timeline = (mode.useTimeline ?? NO_TIMELINE)();
  const showTimeline = timeline !== undefined || mode.noTimeline !== undefined;
  const sheet = useIsSheet();
  const [statuses, setStatuses] = useState<
    Record<string, SectionStatus | undefined>
  >({});
  const report = useCallback(
    (id: string, status: SectionStatus | undefined) => {
      setStatuses((prev) =>
        prev[id]?.label === status?.label &&
        prev[id]?.tone === status?.tone &&
        prev[id]?.detail === status?.detail
          ? prev
          : { ...prev, [id]: status },
      );
    },
    [],
  );
  const status = sections
    .map((s) => statuses[s.id])
    .find((s) => s !== undefined);

  const [detent, setDetent] = useState<Detent>(() =>
    readStored(DETENT_KEY, DETENTS, "peek"),
  );
  const choose = (d: Detent) => {
    setDetent(d);
    store(DETENT_KEY, d);
  };
  const [collapsed, setCollapsed] = useState(
    () => readStored(COLLAPSED_KEY, ["yes", "no"] as const, "no") === "yes",
  );
  const collapse = (yes: boolean) => {
    setCollapsed(yes);
    store(COLLAPSED_KEY, yes ? "yes" : "no");
  };
  // A docked pane slides out to its rule at the screen's left edge; a sheet minimises to its own smallest height.
  const minimised = pane && !sheet && collapsed;
  const showBar = showTimeline;

  /*
   * The region the tiles have: the screen less the docked pane on the left and
   * the Timeline along the bottom, or on a phone less the sheet at its smallest
   * height. The screen lays the tiles, the menu and the banners out in it. On a
   * phone the slider takes its own row above the times, so a Timeline with a
   * run is two rows tall.
   */
  const timelinePx = timeline ? TIMELINE_COMPACT_PX : TIMELINE_HEIGHT_PX;
  const clearance = !pane
    ? showBar
      ? sheet
        ? timelinePx
        : TIMELINE_HEIGHT_PX
      : 0
    : sheet
      ? PEEK_PX + (showTimeline ? timelinePx : 0)
      : showTimeline
        ? TIMELINE_HEIGHT_PX
        : 0;
  const side =
    pane && !sheet ? (minimised ? `${RULE_PX}px` : SIDE_WIDTH) : "0px";
  useEffect(() => {
    const root = globalThis.document?.documentElement;
    root?.style.setProperty("--mode-foot-height", `${clearance}px`);
    root?.style.setProperty("--mode-side-width", side);
    return () => {
      root?.style.removeProperty("--mode-foot-height");
      root?.style.removeProperty("--mode-side-width");
    };
  }, [clearance, side]);

  // Under the Timeline's track on a wide screen. On a phone the sheet's title row carries it.
  const noticeBadge =
    notice && !sheet ? (
      <Badge size="sm" tone="warn" aria-hidden>
        {notice}
      </Badge>
    ) : undefined;
  // Mounted whether or not there is a notice, so the first one is announced. It is what a screen reader reads; the badge is the same words for the eye.
  const announced = <LiveRegion visuallyHidden>{notice}</LiveRegion>;

  if (!pane) {
    if (!showBar) return null;
    return (
      <ModePane__Bar data-mode={mode.id} data-compact={sheet} style={rule}>
        <ModePane__BarRule aria-hidden />
        {announced}
        <ModePane__BarFoot
          role="region"
          aria-label="Timeline"
          style={{
            height: (sheet ? timelinePx : TIMELINE_HEIGHT_PX) - RULE_PX,
          }}
        >
          <Timeline
            timeline={timeline}
            empty={mode.noTimeline ?? title}
            compact={sheet}
            subject={subject}
            trailing={timelineTrailing}
            notice={noticeBadge}
          />
        </ModePane__BarFoot>
      </ModePane__Bar>
    );
  }

  const body = sections.map((s) => (
    <PaneSection key={s.id} augment={s} report={report} />
  ));
  const header = (
    <ModePane__Title>
      <ModePane__Name>{title}</ModePane__Name>
      {/* The state shows once: in its section's heading, or here on a minimised sheet, where the section is out of sight. */}
      {status && sheet && detent === "peek" ? (
        <Badge size="sm" tone={status.tone}>
          {status.label}
        </Badge>
      ) : null}
      {notice && sheet ? (
        <Badge size="sm" tone="warn" aria-hidden>
          {notice}
        </Badge>
      ) : null}
      {announced}
    </ModePane__Title>
  );
  const bar = showTimeline ? (
    <Timeline
      timeline={timeline}
      empty={mode.noTimeline}
      compact={sheet}
      subject={subject}
      trailing={timelineTrailing}
      notice={noticeBadge}
    />
  ) : null;

  if (sheet) {
    return (
      <Sheet
        mode={mode.id}
        rule={rule}
        detent={detent}
        onDetent={choose}
        header={header}
        foot={bar}
        footPx={timelinePx}
      >
        {body}
      </Sheet>
    );
  }
  return (
    <ModePane__Frame
      data-mode={mode.id}
      data-collapsed={minimised}
      style={rule}
    >
      <ModePane__Side
        aria-label={`${title} pane`}
        aria-hidden={minimised || undefined}
      >
        <ModePane__TitleRow>{header}</ModePane__TitleRow>
        <ModePane__Body>{body}</ModePane__Body>
      </ModePane__Side>
      <ModePane__RuleTop aria-hidden />
      <ModePane__RuleBend aria-hidden />
      <ModePane__RuleSide aria-hidden data-timeline={showTimeline} />
      <ModePane__Arrow
        type="button"
        aria-label={minimised ? `Show ${title} pane` : `Minimise ${title} pane`}
        aria-expanded={!minimised}
        onClick={() => collapse(!minimised)}
      >
        {minimised ? "›" : "‹"}
      </ModePane__Arrow>
      {bar ? (
        <>
          <ModePane__JoinFill aria-hidden />
          <ModePane__RuleJoin aria-hidden />
          <ModePane__RuleFoot aria-hidden />
          <ModePane__Foot role="region" aria-label="Timeline">
            {bar}
          </ModePane__Foot>
        </>
      ) : null}
    </ModePane__Frame>
  );
}

function PaneSection({
  augment,
  report,
}: {
  augment: AnyAugment;
  report: (id: string, status: SectionStatus | undefined) => void;
}) {
  const available = useAugmentAvailable(augment);
  const [status, setStatus] = useState<SectionStatus | undefined>(undefined);
  const id = augment.id;
  const reportStatus = useCallback(
    (next: SectionStatus | undefined) => {
      setStatus((prev) =>
        prev?.label === next?.label &&
        prev?.tone === next?.tone &&
        prev?.detail === next?.detail
          ? prev
          : next,
      );
      report(id, next);
    },
    [id, report],
  );
  const props = useMemo(() => ({ reportStatus }), [reportStatus]);
  if (!available) return null;
  const Body = augment.component;
  return (
    <ModePane__Section aria-label={augment.label}>
      <ModePane__SectionHeading>
        <span>{augment.label}</span>
        {status ? (
          <ModePane__Status>
            {status.detail ? <span>{status.detail}</span> : null}
            <Badge size="sm" tone={status.tone}>
              {status.label}
            </Badge>
          </ModePane__Status>
        ) : null}
      </ModePane__SectionHeading>
      <Body {...props} />
    </ModePane__Section>
  );
}

const PEEK_PX = 56;
const HEIGHTS: Record<"half" | "full", string> = {
  half: "50vh",
  full: "92vh",
};

function Sheet({
  mode,
  rule,
  detent,
  onDetent,
  header,
  foot,
  footPx,
  children,
}: {
  mode: string;
  /** The mode's colour, as the style that sets it. */
  rule: CSSProperties;
  detent: Detent;
  onDetent: (d: Detent) => void;
  header: ReactNode;
  /** The Timeline, at the sheet's foot at every height. */
  foot: ReactNode;
  footPx: number;
  children: ReactNode;
}) {
  const peek = PEEK_PX + (foot ? footPx : 0);
  const drag = useRef<{ startY: number; startH: number } | undefined>(
    undefined,
  );
  const ref = useRef<HTMLDivElement>(null);
  const [dragHeight, setDragHeight] = useState<number | undefined>(undefined);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    const h = ref.current?.getBoundingClientRect().height ?? peek;
    drag.current = { startY: e.clientY, startH: h };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    setDragHeight(
      Math.max(peek, drag.current.startH + (drag.current.startY - e.clientY)),
    );
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = undefined;
    if (dragHeight === undefined || !d) return;
    const vh = globalThis.innerHeight || 800;
    const targets: Array<[Detent, number]> = [
      ["peek", peek],
      ["half", vh * 0.5],
      ["full", vh * 0.92],
    ];
    const nearest = targets.reduce((a, b) =>
      Math.abs(b[1] - dragHeight) < Math.abs(a[1] - dragHeight) ? b : a,
    );
    setDragHeight(undefined);
    onDetent(nearest[0]);
  };
  const next =
    DETENTS[(DETENTS.indexOf(detent) + 1) % DETENTS.length] ?? "peek";

  return (
    <>
      {detent === "full" ? (
        <ModePane__Scrim
          type="button"
          aria-label="Lower pane"
          tabIndex={-1}
          onClick={() => onDetent("half")}
        />
      ) : null}
      <ModePane__Sheet
        ref={ref}
        data-mode={mode}
        data-detent={detent}
        style={{
          ...rule,
          height:
            dragHeight !== undefined
              ? `${dragHeight}px`
              : detent === "peek"
                ? `${peek}px`
                : HEIGHTS[detent],
        }}
      >
        <ModePane__ModeBar data-mode={mode} />
        <ModePane__Handle
          type="button"
          aria-label={detent === "full" ? "Lower pane" : "Raise pane"}
          onClick={() => onDetent(next)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
        <ModePane__TitleRow>{header}</ModePane__TitleRow>
        {/* Minimised, the sections stay mounted out of sight, so the one that reports the pane's state still does. */}
        <ModePane__Body hidden={detent === "peek" && dragHeight === undefined}>
          {children}
        </ModePane__Body>
        {foot ? (
          <ModePane__SheetFoot
            role="region"
            aria-label="Timeline"
            style={{ height: footPx }}
          >
            {foot}
          </ModePane__SheetFoot>
        ) : null}
      </ModePane__Sheet>
    </>
  );
}

const ModePane__ModeBar = styled.div`
  height: 3px;
  flex: none;
  background: var(--mode-rule);
`;

const SIDE_WIDTH = "clamp(320px, 28vw, 400px)";
const RULE_PX = 3;
const BEND_PX = 10;

/*
 * Every piece of the docked chrome is fixed to the screen, so the rule is drawn
 * in pieces that share the pane's width and the mode's colour from here: along
 * the pane's top, a bend, down its inner side, a bend, and along the
 * Timeline's top.
 */
const ModePane__Frame = styled.div`
  display: contents;
  --mode-pane-open-width: ${SIDE_WIDTH};
  --mode-pane-width: var(--mode-pane-open-width);
  /* Slid out, the pane leaves only its rule, standing at the screen's left edge. */
  &[data-collapsed="true"] {
    --mode-pane-width: ${RULE_PX}px;
  }
`;

const ModePane__Side = styled.aside`
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: var(--z-sticky);
  display: flex;
  flex-direction: column;
  flex: none;
  width: var(--mode-pane-open-width);
  min-height: 0;
  [data-collapsed="true"] > & {
    transform: translateX(-100%);
    visibility: hidden;
    box-shadow: none;
  }
  @media (prefers-reduced-motion: no-preference) {
    transition:
      transform var(--duration-base) var(--ease-standard),
      visibility 0s linear var(--duration-base);
    [data-collapsed="false"] > & {
      transition: transform var(--duration-base) var(--ease-standard);
    }
  }
  padding-top: ${RULE_PX}px;
  padding-right: ${RULE_PX}px;
  border-top-right-radius: ${BEND_PX}px;
  background: var(--color-surface-panel);
  box-shadow: 4px 0 10px rgba(0, 0, 0, 0.5);
`;

const RulePiece = styled.div`
  position: fixed;
  z-index: calc(var(--z-sticky) + 1);
  pointer-events: none;
  @media (prefers-reduced-motion: no-preference) {
    transition:
      left var(--duration-base) var(--ease-standard),
      width var(--duration-base) var(--ease-standard);
  }
`;

/*
 * The one control over the pane's position: an arrow on the rule, at its top,
 * in the margin the screen keeps between the rule and the tiles. It rides the
 * rule as the pane slides, so it is in the same place relative to the line
 * whether the pane is in or out.
 */
const ModePane__Arrow = styled.button`
  position: fixed;
  top: ${BEND_PX + 2}px;
  left: var(--mode-pane-width);
  z-index: calc(var(--z-sticky) + 2);
  width: calc(var(--gutter-screen) - 4px);
  min-width: 14px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 0 var(--radius-regular) var(--radius-regular) 0;
  background: transparent;
  color: var(--mode-rule);
  font-size: var(--font-size-base);
  line-height: var(--line-height-flush);
  cursor: pointer;
  opacity: 0.7;
  &:hover,
  &:focus-visible {
    opacity: 1;
    background: var(--color-surface-raised);
  }
  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 1px;
  }
  @media (prefers-reduced-motion: no-preference) {
    transition: left var(--duration-base) var(--ease-standard);
  }
`;

const ModePane__RuleTop = styled(RulePiece)`
  top: 0;
  left: 0;
  width: max(0px, calc(var(--mode-pane-width) - ${BEND_PX}px));
  height: ${RULE_PX}px;
  background: var(--mode-rule);
`;

const ModePane__RuleBend = styled(RulePiece)`
  top: 0;
  left: calc(var(--mode-pane-width) - ${BEND_PX}px);
  width: ${BEND_PX}px;
  height: ${BEND_PX}px;
  border-top: ${RULE_PX}px solid var(--mode-rule);
  border-right: ${RULE_PX}px solid var(--mode-rule);
  border-top-right-radius: ${BEND_PX}px;
`;

const ModePane__RuleSide = styled(RulePiece)`
  top: ${BEND_PX}px;
  bottom: 0;
  left: calc(var(--mode-pane-width) - ${RULE_PX}px);
  width: ${RULE_PX}px;
  background: var(--mode-rule);
  &[data-timeline="true"] {
    bottom: ${TIMELINE_HEIGHT_PX - RULE_PX + BEND_PX}px;
  }
`;

/** The panel's colour in the square behind the lower bend, so the pane and the Timeline read as one shape. */
const ModePane__JoinFill = styled(RulePiece)`
  z-index: var(--z-sticky);
  left: calc(var(--mode-pane-width) - ${RULE_PX}px);
  bottom: ${TIMELINE_HEIGHT_PX - RULE_PX}px;
  width: ${BEND_PX}px;
  height: ${BEND_PX}px;
  background: var(--color-surface-panel);
`;

const ModePane__RuleJoin = styled(RulePiece)`
  left: calc(var(--mode-pane-width) - ${RULE_PX}px);
  bottom: ${TIMELINE_HEIGHT_PX - RULE_PX}px;
  width: ${BEND_PX}px;
  height: ${BEND_PX}px;
  border-left: ${RULE_PX}px solid var(--mode-rule);
  border-bottom: ${RULE_PX}px solid var(--mode-rule);
  border-bottom-left-radius: ${BEND_PX}px;
  background: var(--color-surface-app);
`;

const ModePane__RuleFoot = styled(RulePiece)`
  left: calc(var(--mode-pane-width) - ${RULE_PX}px + ${BEND_PX}px);
  right: 0;
  bottom: ${TIMELINE_HEIGHT_PX - RULE_PX}px;
  height: ${RULE_PX}px;
  background: var(--mode-rule);
`;

const ModePane__Foot = styled.div`
  position: fixed;
  left: var(--mode-pane-width);
  right: 0;
  bottom: 0;
  z-index: var(--z-sticky);
  @media (prefers-reduced-motion: no-preference) {
    transition: left var(--duration-base) var(--ease-standard);
  }
  height: ${TIMELINE_HEIGHT_PX - RULE_PX}px;
  display: flex;
  align-items: center;
  background: var(--color-surface-panel);
  & > * {
    flex: 1;
    min-width: 0;
  }
`;

/** A mode with a Timeline and no pane: the Timeline across the bottom of the screen, under the mode line. */
const ModePane__Bar = styled.div`
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: var(--z-sticky);
  display: flex;
  flex-direction: column;
  background: var(--color-surface-panel);
`;

const ModePane__BarRule = styled.div`
  height: ${RULE_PX}px;
  flex: none;
  background: var(--mode-rule);
`;

const ModePane__BarFoot = styled.div`
  display: flex;
  align-items: center;
  & > * {
    flex: 1;
    min-width: 0;
  }
`;

const ModePane__SheetFoot = styled.div`
  flex: none;
  border-top: 1px solid var(--color-border-strong);
`;

const ModePane__TitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-related-compact);
  padding: var(--inset-frame-panel);
  background: var(--color-surface-raised);
  border-bottom: 1px solid var(--color-border-strong);
`;

const ModePane__Title = styled.div`
  display: flex;
  align-items: center;
  gap: var(--gap-related-compact);
  flex: 1;
  min-width: 0;
`;

const ModePane__Name = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-primary);
`;

const ModePane__Body = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
`;

const ModePane__Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related-compact);
  padding: var(--inset-frame-panel);
  border-bottom: 1px solid var(--color-border-subtle);
`;

const ModePane__SectionHeading = styled.h2`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap-related-compact);
  margin: 0;
  font-size: var(--font-size-2xs);
  font-weight: normal;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;

const ModePane__Status = styled.span`
  display: inline-flex;
  align-items: center;
  gap: var(--gap-related-compact);
  text-transform: none;
  letter-spacing: normal;
`;

const ModePane__Sheet = styled.div`
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: var(--z-overlay);
  display: flex;
  flex-direction: column;
  background: var(--color-surface-panel);
  border-top: 1px solid var(--color-border-strong);
  border-radius: var(--radius-floating) var(--radius-floating) 0 0;
  box-shadow: 0 -8px 16px rgba(0, 0, 0, 0.6);
  overflow: hidden;
  @media (prefers-reduced-motion: no-preference) {
    transition: height var(--duration-base) var(--ease-standard);
  }
`;

const ModePane__Handle = styled.button`
  display: block;
  width: 56px;
  height: 18px;
  margin: 0 auto;
  border: 0;
  background: transparent;
  cursor: grab;
  touch-action: none;
  &::after {
    content: "";
    display: block;
    width: 40px;
    height: 4px;
    margin: 0 auto;
    border-radius: var(--radius-pill);
    background: var(--color-border-strong);
  }
  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }
`;

const ModePane__Scrim = styled.button`
  position: fixed;
  inset: 0;
  border: 0;
  padding: 0;
  z-index: calc(var(--z-overlay) - 1);
  background: rgba(0, 0, 0, 0.55);
`;
