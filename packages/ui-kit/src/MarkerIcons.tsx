import { forwardRef, type SVGProps } from "react";

/*
 * An original rendering of the standard spaceflight notation, not traced from
 * the game's artwork; only the hues follow KSP, through the --color-marker-*
 * tokens.
 */

/**
 * Props for the navball marker icons ({@link ProgradeIcon} and the rest).
 *
 * The markers follow the standard spaceflight notation, with hues matching
 * KSP's navball through the `--color-marker-*` tokens. Shape carries the
 * meaning and hue only confirms it: every "towards" marker has a centre dot
 * and every "away" marker a centre cross (⊙ and ⊗), so the two halves of a
 * pair, which share a hue, stay distinct in greyscale. Each marker is drawn
 * first as a wider keyline in `currentColor` (the text colour, which
 * contrasts with the surface) and then as the coloured stroke on top. The
 * drawing is on a 24-unit viewBox. Any other SVG attribute passes through, and
 * the ref reaches the `svg` element.
 *
 * @category Icons
 */
export interface MarkerIconProps
  extends Omit<SVGProps<SVGSVGElement>, "children"> {
  /**
   * Rendered width and height, as pixels or any CSS length. Defaults to the
   * kit's standalone icon size, which grows a step on a coarse pointer.
   */
  size?: number | string;
  /** Width of the coloured stroke, in viewBox units. Defaults to 1.8. */
  strokeWidth?: number;
  /**
   * The icon's accessible name. With one, the icon renders as `role="img"`
   * named by it; without one it is decorative and hidden from assistive
   * technology.
   */
  label?: string;
}

/** Extra width of the keyline beyond the coloured stroke, split across both sides. */
const KEYLINE_EXTRA = 1.4;
const DOT_RADIUS = 1.7;
/** As in `Icons.tsx`: the token reaches the glyph through the presentation attribute, so it steps on a coarse pointer. */
const DEFAULT_SIZE = "var(--icon-size-standalone)";
const DEFAULT_STROKE_WIDTH = 1.8;

type MarkerColour = "prograde" | "normal" | "radial" | "maneuver" | "target";

interface MarkerShape {
  /** Stroked open paths; each string is one `d` attribute. */
  paths: string[];
  /** A filled centre dot, the ⊙ half of the notation. */
  dot?: [cx: number, cy: number];
  colour: MarkerColour;
}

const RING = "M12 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12";
/** A tighter ring for the radial pair, leaving clear space for the chevrons outside it. */
const SMALL_RING = "M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10";
/**
 * The target square's four corner rays, carried onto the velocity ring: the
 * relative-velocity pair is prograde and retrograde in the target's frame.
 * Diagonal, so it reads as neither prograde nor retrograde.
 */
const RELATIVE_RAYS =
  "M7.76 7.76L4.2 4.2M16.24 7.76L19.8 4.2M16.24 16.24L19.8 19.8M7.76 16.24L4.2 19.8";
/**
 * Two rails, the ∥ notation for parallel: along the target's own facing. An
 * open outline, so it is mistaken for neither the ring nor the square.
 */
const RAILS = "M7 4.5V19.5M17 4.5V19.5";
/** The ⊗ half of the notation, centred on (cx, cy). */
const cross = (cx: number, cy: number): string =>
  `M${cx - 2.5} ${cy - 2.5}l5 5M${cx + 2.5} ${cy - 2.5}l-5 5`;

const SHAPES = {
  prograde: {
    colour: "prograde",
    paths: [RING, "M12 6V2.5M6 12H2.5M18 12H21.5"],
    dot: [12, 12],
  },
  retrograde: {
    colour: "prograde",
    paths: [
      RING,
      cross(12, 12),
      "M7.76 7.76L5.3 5.3M16.24 7.76L18.7 5.3M12 18V21.5",
    ],
  },
  normal: {
    colour: "normal",
    paths: ["M12 4.5L19 17H5Z"],
    dot: [12, 13],
  },
  antiNormal: {
    colour: "normal",
    paths: ["M12 19.5L5 7H19Z", cross(12, 11)],
  },
  radialOut: {
    colour: "radial",
    paths: [
      SMALL_RING,
      "M10 4.5L12 2.5L14 4.5M19.5 10L21.5 12L19.5 14M10 19.5L12 21.5L14 19.5M4.5 10L2.5 12L4.5 14",
    ],
    dot: [12, 12],
  },
  radialIn: {
    colour: "radial",
    paths: [
      SMALL_RING,
      "M10 2.5L12 4.5L14 2.5M21.5 10L19.5 12L21.5 14M10 21.5L12 19.5L14 21.5M2.5 10L4.5 12L2.5 14",
      cross(12, 12),
    ],
  },
  maneuver: {
    colour: "maneuver",
    paths: ["M12 5L19 12L12 19L5 12Z", "M12 5V2"],
    dot: [12, 12],
  },
  target: {
    colour: "target",
    paths: [
      "M6 6H18V18H6Z",
      "M6 6L3.5 3.5M18 6L20.5 3.5M18 18L20.5 20.5M6 18L3.5 20.5",
    ],
    dot: [12, 12],
  },
  antiTarget: {
    colour: "target",
    paths: [
      "M6 6H18V18H6Z",
      "M6 6L3.5 3.5M18 6L20.5 3.5M18 18L20.5 20.5M6 18L3.5 20.5",
      cross(12, 12),
    ],
  },
  relativePlus: {
    colour: "target",
    paths: [RING, RELATIVE_RAYS],
    dot: [12, 12],
  },
  relativeMinus: {
    colour: "target",
    paths: [RING, RELATIVE_RAYS, cross(12, 12)],
  },
  parallelPlus: {
    colour: "target",
    paths: [RAILS],
    dot: [12, 12],
  },
  parallelMinus: {
    colour: "target",
    paths: [RAILS, cross(12, 12)],
  },
} satisfies Record<string, MarkerShape>;

/**
 * The id of a navball marker: `prograde`, `retrograde`, `normal`,
 * `antiNormal`, `radialOut`, `radialIn`, `maneuver`, `target`, `antiTarget`,
 * `relativePlus`, `relativeMinus`, `parallelPlus` or `parallelMinus`. The
 * rendered `svg` carries it as `data-marker`.
 *
 * @category Icons
 */
export type MarkerId = keyof typeof SHAPES;

/**
 * Every {@link MarkerId}, in the order a legend or contact sheet should show
 * them.
 *
 * @category Icons
 */
export const MARKER_IDS = Object.keys(SHAPES) as MarkerId[];

function Layer({
  shape,
  colour,
  strokeWidth,
  dotRadius,
}: {
  shape: MarkerShape;
  colour: string;
  strokeWidth: number;
  dotRadius: number;
}) {
  return (
    <g
      fill="none"
      stroke={colour}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {shape.paths.map((d) => (
        <path key={d} d={d} />
      ))}
      {shape.dot && (
        <circle
          cx={shape.dot[0]}
          cy={shape.dot[1]}
          r={dotRadius}
          fill={colour}
          stroke="none"
        />
      )}
    </g>
  );
}

function makeMarker(id: MarkerId, displayName: string) {
  const shape: MarkerShape = SHAPES[id];
  const colour = `var(--color-marker-${shape.colour})`;
  const Marker = forwardRef<SVGSVGElement, MarkerIconProps>(
    (
      {
        size = DEFAULT_SIZE,
        strokeWidth = DEFAULT_STROKE_WIDTH,
        label,
        ...rest
      },
      ref,
    ) => {
      const frame = {
        ref,
        xmlns: "http://www.w3.org/2000/svg",
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        "data-marker": id,
      };
      const layers = (
        <>
          <Layer
            shape={shape}
            colour="currentColor"
            strokeWidth={strokeWidth + KEYLINE_EXTRA}
            dotRadius={DOT_RADIUS + KEYLINE_EXTRA / 2}
          />
          <Layer
            shape={shape}
            colour={colour}
            strokeWidth={strokeWidth}
            dotRadius={DOT_RADIUS}
          />
        </>
      );
      return label ? (
        <svg {...frame} role="img" aria-label={label} {...rest}>
          {layers}
        </svg>
      ) : (
        <svg {...frame} aria-hidden="true" {...rest}>
          {layers}
        </svg>
      );
    },
  );
  Marker.displayName = displayName;
  return Marker;
}

/**
 * The navball prograde marker: a ring with a centre dot and three ticks (top, left, right), in the prograde hue.
 *
 * @category Icons
 */
export const ProgradeIcon = makeMarker("prograde", "ProgradeIcon");
/**
 * The navball retrograde marker: a ring with a centre cross and three ticks (two diagonal above, one below), in the prograde hue.
 *
 * @category Icons
 */
export const RetrogradeIcon = makeMarker("retrograde", "RetrogradeIcon");
/**
 * The navball normal marker: an upward triangle with a centre dot, in the normal hue.
 *
 * @category Icons
 */
export const NormalIcon = makeMarker("normal", "NormalIcon");
/**
 * The navball anti-normal marker: a downward triangle with a centre cross, in the normal hue.
 *
 * @category Icons
 */
export const AntiNormalIcon = makeMarker("antiNormal", "AntiNormalIcon");
/**
 * The navball radial-out marker: a small ring with a centre dot and four chevrons pointing outward, in the radial hue.
 *
 * @category Icons
 */
export const RadialOutIcon = makeMarker("radialOut", "RadialOutIcon");
/**
 * The navball radial-in marker: a small ring with a centre cross and four chevrons pointing inward, in the radial hue.
 *
 * @category Icons
 */
export const RadialInIcon = makeMarker("radialIn", "RadialInIcon");
/**
 * The navball manoeuvre-node marker: a diamond with a centre dot and a tick at the top, in the manoeuvre hue.
 *
 * @category Icons
 */
export const ManeuverIcon = makeMarker("maneuver", "ManeuverIcon");
/**
 * The navball target marker: a square with corner rays and a centre dot, in the target hue.
 *
 * @category Icons
 */
export const TargetIcon = makeMarker("target", "TargetIcon");
/**
 * The navball anti-target marker: a square with corner rays and a centre cross, in the target hue.
 *
 * @category Icons
 */
export const AntiTargetIcon = makeMarker("antiTarget", "AntiTargetIcon");
/**
 * The relative-velocity prograde marker (prograde in the target's frame): a ring with diagonal corner rays and a centre dot, in the target hue.
 *
 * @category Icons
 */
export const RelativePlusIcon = makeMarker("relativePlus", "RelativePlusIcon");
/**
 * The relative-velocity retrograde marker (retrograde in the target's frame): a ring with diagonal corner rays and a centre cross, in the target hue.
 *
 * @category Icons
 */
export const RelativeMinusIcon = makeMarker(
  "relativeMinus",
  "RelativeMinusIcon",
);
/**
 * The parallel marker (along the target's own facing): two vertical rails with a centre dot, in the target hue.
 *
 * @category Icons
 */
export const ParallelPlusIcon = makeMarker("parallelPlus", "ParallelPlusIcon");
/**
 * The anti-parallel marker (against the target's own facing): two vertical rails with a centre cross, in the target hue.
 *
 * @category Icons
 */
export const ParallelMinusIcon = makeMarker(
  "parallelMinus",
  "ParallelMinusIcon",
);

/**
 * The tangent direction of the Frenet frame that n-body flight plans are
 * expressed in. The same component as {@link ProgradeIcon}.
 *
 * @category Icons
 */
export const TangentIcon = ProgradeIcon;

/**
 * The normal direction of the Frenet frame, pointing at the centre of
 * curvature. The same component as {@link RadialInIcon}.
 *
 * @category Icons
 */
export const FrenetNormalIcon = RadialInIcon;

/**
 * The binormal direction of the Frenet frame, which is the orbit normal. The
 * same component as {@link NormalIcon}.
 *
 * @category Icons
 */
export const BinormalIcon = NormalIcon;

/**
 * The marker component for each {@link MarkerId}, for callers driven by data
 * rather than JSX.
 *
 * @example
 * ```tsx
 * const Marker = MARKER_ICONS[id];
 * return <Marker label={name} size={16} />;
 * ```
 *
 * @category Icons
 */
export const MARKER_ICONS: Record<MarkerId, typeof ProgradeIcon> = {
  prograde: ProgradeIcon,
  retrograde: RetrogradeIcon,
  normal: NormalIcon,
  antiNormal: AntiNormalIcon,
  radialOut: RadialOutIcon,
  radialIn: RadialInIcon,
  maneuver: ManeuverIcon,
  target: TargetIcon,
  antiTarget: AntiTargetIcon,
  relativePlus: RelativePlusIcon,
  relativeMinus: RelativeMinusIcon,
  parallelPlus: ParallelPlusIcon,
  parallelMinus: ParallelMinusIcon,
};
