import type React from "react";
import { useState } from "react";
import styled from "styled-components";
import { useZoomPan } from "../shared/useZoomPan";
import { ShipDiagramSvg } from "./ShipDiagramSvg";
import type { ShipMapPart } from "./shipTopology";

interface Props {
  parts: readonly ShipMapPart[];
  /**
   * Case-insensitive part name or title to highlight (typically
   * `therm.hottestPartName`). Matched against both `name` and `title`.
   */
  highlight?: string | null;
  highlightColor?: string;
  width: number;
  height: number;
  /** Current `f.throttle` (0..1+). Forwarded to ShipDiagramSvg so
   *  engine-flame overlays gate on actual thrust. */
  throttle?: number;
}

export function ShipDiagram({
  parts,
  highlight,
  highlightColor,
  width,
  height,
  throttle,
}: Readonly<Props>) {
  const [hovered, setHovered] = useState<ShipMapPart | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  const {
    ref: wrapperRef,
    cam,
    reset: resetView,
    panMoved,
    pointerHandlers,
  } = useZoomPan<HTMLDivElement>();

  const onWrapperMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <Wrapper
      ref={wrapperRef}
      onMouseMove={onWrapperMouseMove}
      {...pointerHandlers}
      $panning={panMoved.current}
    >
      <ResetButton type="button" onClick={resetView} aria-label="Reset view">
        Reset
      </ResetButton>
      <ShipDiagramSvg
        parts={parts}
        width={width}
        height={height}
        highlight={highlight}
        highlightColor={highlightColor}
        cam={cam}
        throttle={throttle}
        onPartHover={setHovered}
        onPartFocus={(_, center) => setMouse(center)}
      />

      {hovered && (
        <Tooltip
          style={{
            left: Math.min(mouse.x + 12, Math.max(0, width - 180)),
            top: Math.min(mouse.y + 12, Math.max(0, height - 80)),
          }}
        >
          <div className="title">{hovered.title || hovered.name}</div>
          <div className="row">
            <span>type</span>
            <span>{hovered.type}</span>
          </div>
          <div className="row">
            <span>mass</span>
            <span>{hovered.dryMass.toFixed(3)} t</span>
          </div>
          {hovered.temperatureK !== undefined &&
          (hovered.maxTemperatureK ?? hovered.maxTemp) > 0 ? (
            <div className="row">
              <span>temp</span>
              <span>
                {Math.round(hovered.temperatureK)} /{" "}
                {Math.round(hovered.maxTemperatureK ?? hovered.maxTemp)} K
              </span>
            </div>
          ) : null}
          <div className="row">
            <span>stage</span>
            <span>{hovered.stage}</span>
          </div>
          {hovered.resources && hovered.resources.length > 0
            ? hovered.resources.map((r) => (
                <div className="row" key={r.n}>
                  <span>{r.n}</span>
                  <span>
                    {r.a.toFixed(0)} / {r.c.toFixed(0)}
                  </span>
                </div>
              ))
            : null}
        </Tooltip>
      )}
    </Wrapper>
  );
}

const Wrapper = styled.div<{ $panning: boolean }>`
  position: relative;
  width: 100%;
  height: 100%;
  touch-action: none;
  user-select: none;
  cursor: ${(p) => (p.$panning ? "grabbing" : "grab")};
`;

const ResetButton = styled.button`
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 10;
  font-size: var(--font-size-xs);
  padding: 2px 8px;
  background: var(--color-surface-raised);
  color: var(--color-status-go-fg);
  border: 1px solid var(--color-border-strong);
  border-radius: 2px;
  cursor: pointer;
  &:hover {
    background: var(--color-border-subtle);
  }
  &:focus-visible {
    outline: 2px solid var(--color-accent-fg);
    outline-offset: 2px;
  }
`;

const Tooltip = styled.div`
  position: absolute;
  background: var(--color-surface-sunken);
  color: var(--color-text-primary);
  font-size: 11px;
  padding: 6px 8px;
  border: 1px solid var(--color-border-strong);
  border-radius: 2px;
  pointer-events: none;
  min-width: 140px;
  z-index: 20;
  .title {
    font-weight: 600;
    color: var(--color-status-go-fg);
    margin-bottom: 4px;
    word-break: break-word;
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    color: var(--color-text-muted);
    span:last-child {
      color: var(--color-text-primary);
    }
  }
`;
