import {
  FullscreenEnterIcon,
  IconButton,
  Tooltip,
  useModal,
} from "@ksp-gonogo/ui-kit";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";
import { gridUnitsForBox } from "./gridMetrics";
import { COLS } from "./layoutNormalization";
import { handleMouseDown } from "./mouseHandlers";

/** What the browser throws away when a node leaves the document, and so must be put back after the move. */
interface LiveState {
  scrolls: { el: HTMLElement; top: number; left: number }[];
  playing: HTMLMediaElement[];
}

function captureLiveState(node: HTMLElement): LiveState {
  const scrolls: LiveState["scrolls"] = [];
  for (const el of [node, ...node.querySelectorAll<HTMLElement>("*")]) {
    if (el.scrollTop !== 0 || el.scrollLeft !== 0) {
      scrolls.push({ el, top: el.scrollTop, left: el.scrollLeft });
    }
  }
  return {
    scrolls,
    playing: Array.from(
      node.querySelectorAll<HTMLMediaElement>("video, audio"),
    ).filter((m) => !m.paused),
  };
}

function restoreScroll(state: LiveState): void {
  for (const { el, top, left } of state.scrolls) {
    el.scrollTop = top;
    el.scrollLeft = left;
  }
}

/**
 * Moves a widget's host node under `target` without unmounting anything React
 * owns. A node that leaves the document loses its scroll offsets and the
 * playback of any media inside it, so those are read first and put back after
 * the move, and the scroll once more a frame later, when the widget has been
 * given its new size and its content has settled. Focus is not carried: the
 * dialog takes it when it opens and hands it back to the button on close.
 */
export function moveWidgetNode(node: HTMLElement, target: HTMLElement): void {
  if (node.parentNode === target) return;
  const state = captureLiveState(node);
  target.appendChild(node);
  restoreScroll(state);
  for (const media of state.playing) {
    void media.play().catch(() => {});
  }
  requestAnimationFrame(() => restoreScroll(state));
}

const SlotBox = styled.div`
  height: 100%;
  min-height: 0;
`;

/** Where a node the chrome owns is shown while it is in the dialog; hands it back before React takes the slot away. */
function DialogSlot({
  node,
  onSize,
  onGone,
  home,
}: Readonly<{
  node: HTMLElement;
  onSize: (width: number, height: number) => void;
  onGone: () => void;
  home: () => HTMLElement | null;
}>) {
  const ref = useRef<HTMLDivElement>(null);
  const onSizeRef = useRef(onSize);
  onSizeRef.current = onSize;
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;
  const homeRef = useRef(home);
  homeRef.current = home;

  useLayoutEffect(() => {
    const slot = ref.current;
    if (!slot) return;
    moveWidgetNode(node, slot);
    const rect = slot.getBoundingClientRect();
    onSizeRef.current(rect.width, rect.height);
    const observer = new ResizeObserver(() => {
      const next = slot.getBoundingClientRect();
      onSizeRef.current(next.width, next.height);
    });
    observer.observe(slot);
    return () => {
      observer.disconnect();
      /* Before React removes the dialog, while the slot is still in the document, so the widget's scroll and focus are read from a live node. */
      const homeEl = homeRef.current();
      if (homeEl) moveWidgetNode(node, homeEl);
      onGoneRef.current();
    };
  }, [node]);

  return <SlotBox ref={ref} />;
}

const InlineSlot = styled.span`
  display: inline-flex;
  align-items: center;
`;

function AdornmentSlot({ node }: Readonly<{ node: HTMLElement }>) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (ref.current) ref.current.appendChild(node);
  }, [node]);
  return <InlineSlot ref={ref} />;
}

export interface Expansion {
  expanded: boolean;
  open: () => void;
  /** Grid units the widget renders at while expanded, undefined while it is in its tile. */
  size: { w: number; h: number } | undefined;
  /** Node the widget renders into through a portal, moved between the tile and the dialog. */
  host: HTMLElement;
  /** Node the push button renders into while the dialog is open. */
  adornment: HTMLElement;
  tileSlot: RefObject<HTMLDivElement>;
}

/**
 * Holds the state of one expandable tile. The widget is rendered once, into a
 * node of its own through a portal, and that node is moved between the tile and
 * the dialog, so React never unmounts the widget and it keeps every piece of
 * state it holds. Used by the grid tile of a widget registered with
 * `expandable`.
 */
export function useExpansion({ name }: Readonly<{ name: string }>): Expansion {
  const { open: openModal, close } = useModal();
  const [host] = useState(() => {
    const el = document.createElement("div");
    el.style.height = "100%";
    return el;
  });
  const [adornmentNode] = useState(() => document.createElement("span"));
  const tileSlot = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [size, setSize] = useState<Expansion["size"]>(undefined);
  const modalId = useRef<string | null>(null);

  /* The node is first placed in the tile; every later move is made by the dialog's slot, in and back out. */
  useLayoutEffect(() => {
    if (tileSlot.current) moveWidgetNode(host, tileSlot.current);
  }, [host]);

  useEffect(
    () => () => {
      if (modalId.current) close(modalId.current);
    },
    [close],
  );

  const open = useCallback(() => {
    setExpanded(true);
    modalId.current = openModal(
      <DialogSlot
        node={host}
        home={() => tileSlot.current}
        onSize={(width, height) =>
          setSize(gridUnitsForBox(width, height, window.innerWidth, COLS))
        }
        onGone={() => {
          modalId.current = null;
          setExpanded(false);
          setSize(undefined);
        }}
      />,
      {
        title: name,
        headerActions: <AdornmentSlot node={adornmentNode} />,
        expanded: true,
      },
    );
  }, [openModal, host, name, adornmentNode]);

  return { expanded, open, size, host, adornment: adornmentNode, tileSlot };
}

const TileFrame = styled.div`
  position: relative;
  height: 100%;
`;

const Placeholder = styled.div`
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: var(--color-surface-panel);
  color: var(--color-text-muted);
  font-size: var(--font-size-compact);
`;

/**
 * Draws a tile's widget through the portal that lets it move into the dialog,
 * and what the tile shows while the widget is away.
 */
export function ExpansionHost({
  expansion,
  pushButton,
  children,
}: Readonly<{
  expansion: Expansion;
  pushButton: ReactNode;
  children: ReactNode;
}>) {
  return (
    <TileFrame>
      <SlotBox ref={expansion.tileSlot} />
      {expansion.expanded && <Placeholder>Open in expanded view</Placeholder>}
      {createPortal(children, expansion.host)}
      {expansion.expanded && createPortal(pushButton, expansion.adornment)}
    </TileFrame>
  );
}

/** The header button that expands the widget; the first of the tile's buttons so the others never move. */
export function ExpandButton({
  expansion,
  name,
}: Readonly<{ expansion: Expansion; name: string }>) {
  const label = `Expand ${name}`;
  return (
    <Tooltip text={label}>
      <IconButton
        type="button"
        onMouseDown={handleMouseDown}
        onClick={(e) => {
          e.stopPropagation();
          expansion.open();
        }}
        aria-label={label}
      >
        <FullscreenEnterIcon size={12} />
      </IconButton>
    </Tooltip>
  );
}
