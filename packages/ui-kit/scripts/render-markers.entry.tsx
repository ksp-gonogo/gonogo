/**
 * The browser half of `render-markers.ts`: mounts the contact sheet and marks
 * the root ready once React has committed it.
 */
import { createRoot } from "react-dom/client";
import { MARKER_ICONS, MARKER_IDS, type MarkerId } from "../src/MarkerIcons";

const LABELS: Record<MarkerId, string> = {
  prograde: "prograde",
  retrograde: "retrograde",
  normal: "normal",
  antiNormal: "anti-normal",
  radialOut: "radial out",
  radialIn: "radial in",
  maneuver: "maneuver",
  target: "target",
  antiTarget: "anti-target",
  relativePlus: "relative +",
  relativeMinus: "relative -",
  parallelPlus: "parallel +",
  parallelMinus: "parallel -",
};

/**
 * Dichromacy simulation, Machado, Oliveira and Fernandes (2009), severity 1.0.
 * Row-major 3x3 over linear-ish sRGB; close enough for a legibility check.
 */
const CVD: Record<string, number[]> = {
  protanopia: [
    0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882,
    -0.048116, 1.051998,
  ],
  deuteranopia: [
    0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182,
    0.04294, 0.968881,
  ],
  tritanopia: [
    1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733,
    0.691367, 0.3039,
  ],
};

function matrixValues(m: number[]): string {
  const [a, b, c, d, e, f, g, h, i] = m;
  return `${a} ${b} ${c} 0 0  ${d} ${e} ${f} 0 0  ${g} ${h} ${i} 0 0  0 0 0 1 0`;
}

const DARK = { background: "#0d0d0d", color: "#ccc" };
const LIGHT = { background: "#f4f4f0", color: "#1a1a1a" };

interface RowSpec {
  title: string;
  ground: typeof DARK;
  filter?: string;
  size: number;
}

const ROWS: RowSpec[] = [
  { title: "dark surface, 56px", ground: DARK, size: 56 },
  { title: "dark surface, 20px (the kit default)", ground: DARK, size: 20 },
  { title: "dark surface, 14px (the SAS buttons)", ground: DARK, size: 14 },
  { title: "light surface, 56px", ground: LIGHT, size: 56 },
  { title: "light surface, 20px", ground: LIGHT, size: 20 },
  {
    title: "greyscale, dark surface",
    ground: DARK,
    filter: "grayscale(1)",
    size: 56,
  },
  {
    title: "greyscale, light surface",
    ground: LIGHT,
    filter: "grayscale(1)",
    size: 56,
  },
  ...Object.keys(CVD).map((kind) => ({
    title: `${kind} simulation, dark surface`,
    ground: DARK,
    filter: `url(#cvd-${kind})`,
    size: 56,
  })),
];

function Row({ title, ground, filter, size }: RowSpec) {
  return (
    <section
      style={{
        background: ground.background,
        color: ground.color,
        padding: "10px 16px 12px",
        filter,
      }}
    >
      <h2
        style={{
          margin: "0 0 8px",
          fontSize: 11,
          fontWeight: 500,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          opacity: 0.7,
        }}
      >
        {title}
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${MARKER_IDS.length}, 1fr)`,
          gap: 8,
        }}
      >
        {MARKER_IDS.map((id) => {
          const Icon = MARKER_ICONS[id];
          return (
            <figure
              key={id}
              style={{
                margin: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Icon size={size} label={LABELS[id]} />
              <figcaption style={{ fontSize: 10, letterSpacing: "0.05em" }}>
                {LABELS[id]}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </section>
  );
}

function Sheet() {
  return (
    <div style={{ width: 1500 }}>
      <svg
        aria-hidden="true"
        width="0"
        height="0"
        style={{ position: "absolute" }}
      >
        {Object.entries(CVD).map(([kind, m]) => (
          <filter
            key={kind}
            id={`cvd-${kind}`}
            colorInterpolationFilters="sRGB"
          >
            <feColorMatrix type="matrix" values={matrixValues(m)} />
          </filter>
        ))}
      </svg>
      {ROWS.map((row) => (
        <Row key={row.title} {...row} />
      ))}
    </div>
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root missing");
const root = createRoot(rootEl);
root.render(<Sheet />);
requestAnimationFrame(() =>
  requestAnimationFrame(() => rootEl.setAttribute("data-sheet-ready", "1")),
);
