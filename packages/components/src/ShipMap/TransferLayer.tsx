import type { Value } from "@ksp-gonogo/sitrep-sdk";
import { FlowChevrons, resourceColor, Unit } from "@ksp-gonogo/ui-kit";
import type { ProjectedPart } from "./shipLayout";

/** How one tank is marked on the diagram. */
export type TankMark = "from" | "to" | "blocked" | "out" | "in";

/** One running transfer as the diagram draws it. */
export interface TransferFlowDrawing {
  id: string;
  resource: string;
  fromPartIds: readonly number[];
  toPartIds: readonly number[];
  /** Absent when there is none to show. */
  rate?: Value<"units/s">;
}

/** Everything transfer-related the diagram draws. */
export interface TransferDrawing {
  marks: ReadonlyMap<number, TankMark>;
  flows: readonly TransferFlowDrawing[];
  /** The list of running transfers is the last received, so nothing may look like it is moving now. */
  held: boolean;
}

/* Past this many tanks in one job the pipes stop being readable and only the marks remain. */
const MAX_PIPED_TANKS = 8;

const MARK_LABEL: Record<TankMark, string> = {
  from: "FROM",
  to: "TO",
  blocked: "",
  out: "OUT",
  in: "IN",
};

const MARK_COLOR: Record<TankMark, string> = {
  from: "var(--color-tag-yellow-fg)",
  out: "var(--color-tag-yellow-fg)",
  to: "var(--color-tag-blue-fg)",
  in: "var(--color-tag-blue-fg)",
  blocked: "var(--color-text-faint)",
};

function Pipe({
  from,
  to,
  zoom,
  color,
  held,
}: Readonly<{
  from: { x: number; y: number };
  to: { x: number; y: number };
  zoom: number;
  color: string;
  held: boolean;
}>) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const thickness = 12 / zoom;
  const stride = 14 / zoom;
  const w = 6 / zoom;
  const h = 7 / zoom;
  const count = Math.floor(len / stride);
  return (
    <g
      data-role="transfer-pipe"
      pointerEvents="none"
      transform={`translate(${from.x.toFixed(2)} ${from.y.toFixed(2)}) rotate(${angle.toFixed(2)})`}
    >
      <rect
        y={-thickness / 2}
        width={len}
        height={thickness}
        rx={thickness * 0.35}
        fill={held ? "none" : color}
        stroke={color}
        strokeWidth={1 / zoom}
        strokeDasharray={held ? `${4 / zoom} ${3 / zoom}` : undefined}
      />
      {held ? null : (
        <clipPath id={`pipe-${from.x}-${from.y}-${to.x}-${to.y}`}>
          <rect y={-thickness / 2} width={len} height={thickness} />
        </clipPath>
      )}
      <g
        clipPath={
          held ? undefined : `url(#pipe-${from.x}-${from.y}-${to.x}-${to.y})`
        }
      >
        {held ? (
          chevrons(count, stride, w, h, color)
        ) : (
          <FlowChevrons stride={stride}>
            {chevrons(
              count + 1,
              stride,
              w,
              h,
              "var(--color-surface-app)",
              -stride,
            )}
          </FlowChevrons>
        )}
      </g>
    </g>
  );
}

function chevrons(
  count: number,
  stride: number,
  w: number,
  h: number,
  fill: string,
  start = 0,
) {
  return Array.from({ length: count }, (_, i) => {
    const x = start + (i + 0.5) * stride;
    return (
      <polygon
        // biome-ignore lint/suspicious/noArrayIndexKey: chevrons have no identity beyond their order along the pipe
        key={i}
        points={`${x - w / 2},${-h / 2} ${x - w / 2},${h / 2} ${x + w / 2},0`}
        fill={fill}
      />
    );
  });
}

/**
 * Tanks being picked for a transfer and transfers that are running, drawn over
 * the parts. A running transfer is a pipe from each source to a junction and on
 * to each destination. It is a picture of what is moving where, not of the
 * plumbing: a vessel-wide resource has no physical line.
 */
export function TransferLayer({
  drawing,
  partsById,
  toBase,
  zoom,
}: Readonly<{
  drawing: TransferDrawing;
  partsById: ReadonlyMap<number, ProjectedPart>;
  toBase: (lat: number, axial: number) => { x: number; y: number };
  zoom: number;
}>) {
  const at = (id: number) => {
    const part = partsById.get(id);
    return part ? toBase(part.lat, part.axial) : null;
  };

  return (
    <g data-role="transfer-layer">
      {drawing.flows.map((job) => {
        if (job.fromPartIds.length + job.toPartIds.length > MAX_PIPED_TANKS) {
          return null;
        }
        const sources = job.fromPartIds.map(at).filter((p) => p !== null);
        const targets = job.toPartIds.map(at).filter((p) => p !== null);
        if (sources.length === 0 || targets.length === 0) return null;
        const all = [...sources, ...targets];
        const hub = {
          x: all.reduce((sum, p) => sum + p.x, 0) / all.length,
          y: all.reduce((sum, p) => sum + p.y, 0) / all.length,
        };
        const color = resourceColor(job.resource);
        return (
          <g key={job.id} data-transfer={job.id}>
            {sources.map((p) => (
              <Pipe
                key={`s${p.x},${p.y}`}
                from={p}
                to={hub}
                zoom={zoom}
                color={color}
                held={drawing.held}
              />
            ))}
            {targets.map((p) => (
              <Pipe
                key={`t${p.x},${p.y}`}
                from={hub}
                to={p}
                zoom={zoom}
                color={color}
                held={drawing.held}
              />
            ))}
            <circle
              cx={hub.x}
              cy={hub.y}
              r={8 / zoom}
              fill={color}
              pointerEvents="none"
            />
            {job.rate && (
              <foreignObject
                x={hub.x - 60 / zoom}
                y={hub.y - 36 / zoom}
                width={120 / zoom}
                height={20 / zoom}
                pointerEvents="none"
              >
                <div
                  style={{
                    textAlign: "center",
                    fontSize: 11 / zoom,
                    fontWeight: 700,
                    color: "var(--color-text-primary)",
                  }}
                >
                  <Unit value={job.rate} decimals={1} />
                </div>
              </foreignObject>
            )}
          </g>
        );
      })}
      {[...drawing.marks].map(([id, mark]) => {
        const part = partsById.get(id);
        if (!part) return null;
        const center = toBase(part.lat, part.axial);
        const label = MARK_LABEL[mark];
        const color = MARK_COLOR[mark];
        return (
          <g key={id} data-mark={mark} pointerEvents="none">
            <circle
              cx={center.x}
              cy={center.y}
              r={5 / zoom}
              fill={mark === "blocked" ? "none" : color}
              stroke={color}
              strokeWidth={1.5 / zoom}
            />
            {label && (
              <text
                x={center.x}
                y={center.y - 10 / zoom}
                textAnchor="middle"
                fontSize={10 / zoom}
                fontWeight={700}
                fill={color}
                stroke="var(--color-surface-app)"
                strokeWidth={3 / zoom}
                paintOrder="stroke"
              >
                {label}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
