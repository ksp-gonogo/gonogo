import type {
  CSSProperties,
  MouseEventHandler,
  ReactNode,
  RefObject,
} from "react";
import styled from "styled-components";
import { focusRingInset } from "./focusRing";
import type { UsePanZoomResult } from "./usePanZoom";

/**
 * The element that holds a pannable, zoomable diagram: it takes the drag,
 * pinch, wheel and keyboard input of a {@link usePanZoom} result, shows its
 * focus ring, and shows a one-line note on the keys while it has keyboard
 * focus. Useful for giving every diagram the same hands-on behaviour. Used by
 * the system, map and ship diagrams.
 *
 * @category Layout
 */
export function PanZoomViewport({
  panZoom,
  label,
  style,
  onMouseMove,
  children,
}: {
  /** The result of {@link usePanZoom} for this diagram. */
  panZoom: UsePanZoomResult;
  /** What the diagram is, for assistive technology ("System diagram"). */
  label: string;
  style?: CSSProperties;
  /** Pointer movement over the diagram, for a caller that places a tooltip at the cursor. */
  onMouseMove?: MouseEventHandler<HTMLDivElement>;
  children: ReactNode;
}) {
  const { style: gestureStyle, ref, ...rest } = panZoom.viewportProps;
  return (
    <Viewport
      {...rest}
      ref={ref as RefObject<HTMLDivElement>}
      onMouseMove={onMouseMove}
      aria-label={label}
      style={{ ...gestureStyle, ...style }}
    >
      {children}
      <HintRegion role="status">
        {panZoom.hint !== null && <Chip>{panZoom.hint}</Chip>}
      </HintRegion>
    </Viewport>
  );
}

const Viewport = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  user-select: none;
  ${focusRingInset}
`;

/** Always mounted, so a screen reader that has registered the region hears the hint when it appears. */
const HintRegion = styled.div`
  position: absolute;
  bottom: var(--gap-related);
  left: 50%;
  transform: translateX(-50%);
  z-index: var(--z-base);
  max-width: calc(100% - 16px);
  pointer-events: none;
`;

const Chip = styled.div`
  padding: var(--inset-control);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-regular);
  background: var(--color-surface-raised);
  color: var(--color-text-primary);
  font-size: var(--font-size-compact);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;
