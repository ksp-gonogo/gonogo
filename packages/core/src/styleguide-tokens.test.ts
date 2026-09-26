import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { styleguideScanRoots } from "./styleguideScanRoots";

/**
 * Design-system guard: prevent new hardcoded spacing, radius, font-size,
 * line-height, z-index and motion values leaking back in now that the scales in
 * `packages/theme/src/tokens.css` exist.
 *
 * Why this file exists at all: font-size had tokens BEFORE the migration
 * and 413 of its 637 call sites ignored them, because nothing failed
 * when they did. Raw hex, by contrast, has held at (almost) zero for
 * months, because `styleguide.test.ts` fails the build the moment a new
 * one lands. A token set with no gate rots; these are the gates.
 *
 * Same ratchet shape as the hex guard, one `it` per family:
 *   - a NEW hardcoded value fails the build, naming file, line, property
 *     and value;
 *   - a documented per-file baseline covers what legitimately remains
 *     today, each entry of which is commented at its call site with why
 *     it stayed literal;
 *   - cleaning one up prints a hint to lower that file's entry in the
 *     same commit rather than failing, so a cleanup lands green;
 *   - `EXCEPTIONS` exempts a path (optionally for one family only) for
 *     the cases that will never be tokenised, and every entry must carry
 *     a reason, which the last test in this file enforces.
 *
 * The route for a new value is: read the name for its job from
 * `packages/theme/src/tokens.css` and write `var(--gap-related)` and
 * friends. For spacing, a job with no name gets one there. For the other
 * families, if no rung fits, the value is telling you something about the
 * design, not about the scale: say so in a comment at the call site and
 * raise the baseline, or add an EXCEPTIONS entry if the whole file is
 * off-ladder.
 *
 * What this scan deliberately does NOT flag:
 *   - `0` and `0px`. There is no zero rung and there should not be one.
 *   - `rem` / `em` / `%` / `ch` / viewport and container units. These are
 *     relative by intent (the two `rem` clusters in the app are sized
 *     against the browser font size on purpose, an accessibility
 *     property a px token would destroy). The ladders are px ladders.
 *   - values inside `var(...)` or `env(...)`, so a fallback such as
 *     `var(--example, 8px)` reads as a token reference, which is what it is.
 *   - `width` / `height` / `top` / `left` / `border-width` / `transform`
 *     / `outline-offset`. The pass is keyed on property, not on value,
 *     exactly as the migration was: a 14px column width and a 14px inset
 *     share a numeral and nothing else, and focus-ring geometry is a
 *     WCAG indicator rather than spacing.
 *
 * Known blind spot, worth stating rather than pretending away: a value
 * reaching CSS through an interpolation (`font-size: ${TERMINAL_FONT_PX}px`,
 * `padding: ${PAD}`) is invisible here, because the scan reads source
 * text, not computed styles. Those sites are the ones the migration
 * hoisted to a single named constant with a comment; the constant is the
 * documentation the ratchet cannot be.
 */

type Family =
  | "spacing"
  | "radius"
  | "fontSize"
  | "lineHeight"
  | "zIndex"
  | "motion";

interface Exception {
  path: string;
  /** Families this path is excused from, or "all". */
  families: Family[] | "all";
  /** Why this file will never sit on the ladder. Required, and enforced. */
  reason: string;
}

const EXCEPTIONS: Exception[] = [
  {
    path: "packages/theme/src/tokens.css",
    families: "all",
    reason:
      "The ladders themselves. Every rung in this file is a literal by definition, and flagging them would be flagging the answer as the offence. The rest of packages/theme/src IS scanned: defaultDarkTheme.ts held its own raw px for space and radii long after the migration precisely because the whole package used to be excluded, so the exclusion is now the one file rather than the directory.",
  },
  {
    path: "packages/ui-kit/src/VisuallyHidden.tsx",
    families: ["spacing"],
    reason:
      "The clip-rect visually-hidden recipe, whose whole point is to occupy no layout. Its 1px box and -1px margin are a matched pair that cancel each other out: the box exists so screen readers still reach the text, and the negative margin removes the pixel it would otherwise take. Neither number is a spacing decision, and putting either on the ladder would change the box to a size the recipe does not work at.",
  },
  {
    path: "packages/app/src/styles/react-resizable.css",
    families: "all",
    reason:
      "Geometry locked to react-grid-layout's resize handles, not to our ladders: the two -10px margins are exactly half the 20px handle they centre, and the z-index 5 is a locked adjacent pair with GridItemContent's 6 inside the grid item's own stacking context. Both are already commented as such in the file. Tokenising either would make our scale responsible for a third-party widget's hit area.",
  },
];

/**
 * Which baseline key a scanned file counts against. Files under `packages/`
 * are keyed by their own path, so the failure names exactly what moved.
 * Everything under `mod/` shares one `"mod/"` bucket, because `packages/core`
 * may not name Uplink paths: `uplink-boundary.test.ts` fails the build on any
 * mention of an Uplink outside its owning directory, and a per-file map here
 * would have to spell those directories out. The runtime failure still prints
 * the exact mod file, because that comes from the scan rather than from this
 * table; only the committed baseline is coarse.
 */
function baselineKey(file: string): string {
  return file.startsWith("mod/") ? "mod/" : file;
}

/**
 * Per-family baselines: what legitimately remains after the migration,
 * counted PER FILE rather than as one total. Every site counted here
 * carries a comment at its call site explaining why it stayed literal;
 * the census behind those decisions is in the tokens.css ladder comments.
 *
 * Per file, not a single number, for two reasons. A bare total can only
 * say "you added one" and then has to guess which one, and the guess is
 * wrong: it names whichever sites happen to sort last, so the author gets
 * pointed at innocent files while their own change goes unmentioned. A
 * per-file map names the file that actually moved. It also catches a case
 * a total silently misses: a literal MOVING from one file to another
 * leaves the total unchanged.
 *
 * When you legitimately add one: put the reason in a comment at the call
 * site, then add or raise that file's entry here. When you clean one up,
 * lower it (or delete the key) in the same commit; the tests warn rather
 * than fail on a drop, so a cleanup lands green.
 */
const BASELINES: Record<Family, Record<string, number>> = {
  /**
   * 51 across 21 files. Mostly four groups: the `StationConnectView` page
   * (19, exempted wholesale by the migration reviewer, it needs a
   * page-scale decision rather than a widget-ladder one), negative offsets
   * that are computed halves rather than rungs (`margin: -1px` sr-only
   * clips, MapPoiLayer's -5px centring, Strategies' -5px, ui-kit `Tabs`'
   * indicator overlap), off-ladder values held with an arithmetic comment
   * (FleetRoster's 7px and 21px, Navball's 10px in a 42px reserve, Twr's
   * 20px, ThermalStatus' 5px/10px pill), and the `components/src/shared/`
   * files plus a few mod widgets that no migration slice owned.
   */
  spacing: {
    "packages/app/src/styles/global.css": 1,
    "packages/components/src/FleetRoster/index.tsx": 2,
    "packages/components/src/MapView/MapPoiLayer.tsx": 2,
    "packages/components/src/Navball/index.tsx": 1,
    "packages/components/src/shared/RequiresGuard.tsx": 3,
    "packages/components/src/StationConnectView/index.tsx": 19,
    "packages/components/src/Strategies/index.tsx": 1,
    "packages/components/src/ThermalStatus/index.tsx": 2,
    "packages/components/src/Twr/index.tsx": 1,
    "packages/data/src/FlightsManager/index.tsx": 2,
    "packages/serial/src/SerialDevicesMenu/ProtocolReferenceModal.tsx": 1,
    "packages/ui/src/FileInput.tsx": 1,
  },
  /**
   * 9 across 5 files. Four in `StationConnectView` (exempt page), and five
   * hairline or half-height radii deliberately off the semantic names:
   * CommSignal's 1px bar, ActionGroup's focus-ring radius, InputTester's
   * nested pair, OrbitalEventChips' chip.
   */
  radius: {
    "packages/components/src/CommSignal/index.tsx": 1,
    "packages/components/src/StationConnectView/index.tsx": 4,
    "packages/serial/src/InputTester/index.tsx": 2,
  },
  /**
   * 61 across 33 files. Two thirds are display-tier sizes above the
   * scale's `lg` ceiling (18/20/22/24/28px readouts) and fluid `clamp()`
   * readouts, both of which the scale stops short of on purpose. The rest
   * are sizes locked into a fixed box or a coarse-pointer calculation
   * (Navball's 9px and 14px terms in a 74px reserve, TechTree's card
   * ladder against CARD_H = 48, Targeting's 11px, PanelStatusDot's
   * 7px pinned under an 11px dot), plus `shared/` and mod widgets no slice
   * owned.
   */
  fontSize: {
    "packages/app/src/components/ComponentOverlay.tsx": 2,
    "packages/app/src/components/StationConnectionFab.tsx": 1,
    "packages/app/src/components/StationLinkFab.tsx": 1,
    "packages/app/src/goNoGo/GoNoGoComponent.tsx": 5,
    "packages/components/src/CrewStatus/index.tsx": 2,
    "packages/components/src/CurrentOrbit/index.tsx": 1,
    "packages/components/src/FuelStatus/index.tsx": 2,
    "packages/components/src/MapView/MapView.styles.ts": 1,
    "packages/components/src/Navball/AttitudeIndicator.tsx": 3,
    "packages/components/src/PowerSystems/index.tsx": 1,
    "packages/components/src/SemiMajorAxis/index.tsx": 1,
    "packages/components/src/shared/OrbitalEventChips.tsx": 2,
    "packages/components/src/shared/RequiresGuard.tsx": 2,
    "packages/components/src/SpaceCenterStatus/index.tsx": 3,
    "packages/components/src/StationConnectView/index.tsx": 7,
    "packages/components/src/SystemView/index.tsx": 1,
    "packages/components/src/TechTree/index.tsx": 5,
    "packages/components/src/Twr/index.tsx": 1,
    "packages/components/src/WarpControl/index.tsx": 1,
    "packages/serial/src/SerialDevicesMenu/CalibrateWizard.tsx": 1,
    "packages/serial/src/SerialDevicesMenu/ProtocolReferenceModal.tsx": 1,
    "packages/serial/src/VirtualDevice/index.tsx": 1,
    "packages/ui-kit/src/Form.tsx": 1,
    // The FLOOR under a relative size, not a size: a time-context qualifier is
    // sized against the instant it qualifies (`0.72em`, the same rule `<Unit>`
    // sizes a symbol by) so it composes into a 32px readout and an 11px table
    // cell alike. A rung would pin it to one of those. 10px is where this UI
    // stops being legible, which is a property of the display rather than of
    // the scale. `<Unit>` escapes this scan only because its identical rule
    // reaches CSS through an interpolation, which is the blind spot the header
    // above names.
    "packages/ui-kit/src/MissionDate.tsx": 1,
    "packages/ui-kit/src/Readout.tsx": 3,
    "packages/ui-kit/src/status/PanelStatusDot.tsx": 1,
    "packages/ui/src/FabPrompt.tsx": 1,
  },
  /**
   * 4 across 4 files. Values between the four role rungs, each paired with a
   * fixed height or an `em` sibling that would drift if they moved.
   */
  lineHeight: {
    "packages/components/src/SpaceCenterStatus/index.tsx": 1,
    "packages/components/src/TechTree/index.tsx": 1,
    "packages/serial/src/VirtualDevice/index.tsx": 1,
    "packages/ui-kit/src/Readout.tsx": 1,
  },
  /**
   * 21 across 16 files. Every one is LOCAL sibling ordering inside a
   * component's own stacking context (the 0/1/2, 5/6 and 10/20 families),
   * which the ladder in tokens.css explicitly declines to absorb: pulling
   * them onto app-global rungs would collapse independent contexts into
   * one. The exception is `ui/BannerStack`'s 90, held at a literal on
   * purpose with a comment recording the WCAG precondition for promoting
   * it.
   */
  zIndex: {
    "packages/app/src/components/Dashboard/GridItemContent.tsx": 1,
    "packages/components/src/AtmosphereProfile/index.tsx": 1,
    "packages/components/src/MapView/MapPoiLayer.tsx": 1,
    "packages/components/src/ShipMap/index.tsx": 2,
    "packages/components/src/ShipMap/ShipDiagram.tsx": 2,
    "packages/components/src/SystemView/SystemDiagram.tsx": 1,
    "packages/data/src/FlightsManager/FlightGraph.tsx": 1,
    // The table's sticky column header over its own scrolling rows, local
    // sibling ordering inside the table's stacking context. Not app-global
    // chrome, so a named rung would put a table header in the dashboard's
    // layer for no reason.
    "packages/ui-kit/src/DataTable.tsx": 1,
    // The composer's blocked flag over the bar it is pinned to, local sibling
    // ordering inside that bar's own stacking context. Not app-global chrome,
    // so a named rung would put a one-word badge in the dashboard's layer.
    // Arrived with the bar itself, in the change that lifted it out of the
    // terminal widget; this entry is the baseline raise that change owed and
    // did not make, which is why it lands with the branch that first ran the
    // scan against it rather than with a Commcast change of its own.
    "packages/ui-kit/src/ComposerBar.tsx": 1,
    // The console's standing-reading slot over the composer's top border,
    // local sibling ordering inside that frame's stacking context. Not
    // app-global chrome, so a named rung would lift a delay chip into the
    // dashboard's. Moved here from the terminal widget, which pinned its own
    // copy until both consoles were made to share the slot.
    "packages/ui-kit/src/ConsoleFrame.tsx": 1,
    // The disclosure panel overlay, local sibling ordering inside the
    // component's own stacking context (lifts the popped panel above following
    // content). Not app-global chrome, so no named z rung.
    "packages/ui-kit/src/Disclosure.tsx": 1,
    // Local sibling ordering inside the panel's own stacking context: the
    // scroll glow over the scrolling body, the overlay header over the content
    // beneath it, and the popped aside-expand box over that header. None is
    // app-global chrome, so a named rung would lift a widget-internal overlay
    // above the dashboard's.
    "packages/ui-kit/src/Panel.tsx": 4,
    // The signal-delay rail's detail float, local sibling ordering inside the
    // panel's own stacking context: it must sit above the sticky header
    // (Panel.tsx's z-index 2) and the scrolling body it overlays. Not
    // app-global chrome, so a named z rung would over-lift it.
    "packages/ui-kit/src/CommandDelay/PanelDelayRail.tsx": 1,
    // The scroll-shadow edge fade over the tab bar, local sibling ordering
    // inside the tab bar's own stacking context. Not app-global chrome, so
    // no named z rung.
    "packages/ui-kit/src/Tabs.tsx": 1,
    "packages/ui/src/BannerStack.tsx": 1,
    "packages/ui/src/DimmedOverlay.tsx": 1,
  },
  /**
   * 31 across 21 files, and every one is a duration or easing that carries
   * information rather than style. The two in global.css are the
   * reduced-motion damper's `0.01ms !important`, which is a documented
   * override of everything else and must not become a token. The rest are
   * the physical animations the scale deliberately stops short of: a
   * resource bar tied to the telemetry sample cadence, a reticle chasing a
   * moving target, a 1Hz terminal caret, spinners, and indicators whose
   * period is how the operator reads connection state. Folding those onto
   * a UI-transition scale would destroy the thing they encode.
   *
   * A NEW literal here is almost certainly a UI transition that wants
   * --duration-base and --ease-standard. If it genuinely is physical, say
   * what it is timed against at the call site and raise its entry.
   */
  motion: {
    "packages/app/src/styles/global.css": 2,
    "packages/components/src/LaunchDirector/index.tsx": 1,
    "packages/components/src/Navball/AttitudeIndicator.tsx": 2,
    "packages/components/src/Navball/index.tsx": 2,
    "packages/components/src/ShipMap/index.tsx": 2,
    "packages/components/src/SpaceCenterStatus/index.tsx": 1,
    "packages/serial/src/InputMappingTab.tsx": 1,
    "packages/serial/src/InputTester/index.tsx": 1,
    "packages/serial/src/SerialDevicesMenu/GamepadLearnWizard.tsx": 1,
    "packages/serial/src/SerialDevicesMenu/SelfDescribingAddWizard.tsx": 1,
    "packages/ui-kit/src/CommandDelay/InFlightList.tsx": 1,
    "packages/ui-kit/src/ProgressBar.tsx": 2,
    "packages/ui-kit/src/Readout.tsx": 1,
    "packages/ui/src/BannerPill.tsx": 1,
    "packages/ui/src/Fab.tsx": 1,
    "packages/ui/src/SourceOfflineBanner.tsx": 2,
  },
};

interface FamilySpec {
  /** Human label for the failure message. */
  label: string;
  /** CSS properties and JS style keys this family owns. */
  properties: string[];
  /** What to write instead. */
  remedy: string;
  /** Offending literals inside an already-var-stripped value. */
  hits: (value: string, property: string) => string[];
  /**
   * Source text this family MUST find a hit in, one entry per SHAPE the app
   * writes the declaration in. A regex that stops matching reports zero
   * offenders and zero reads as a clean tree, so every run plants each of
   * these and fails as blind if the scan cannot see one.
   *
   * Two shapes, because the app writes both and they travel through different
   * code here. The css one goes through the kebab-case half of `properties`
   * and reads its value bare; the style-object one goes through the camelCase
   * half and arrives quoted with a trailing comma, which only `bareNumber`
   * undoes for the unitless families. A single css plant proves neither of
   * those: a matcher can find every css plant while it is blind to every
   * inline style in the tree.
   */
  plants: { shape: "css" | "style object"; source: string }[];
}

/** px literals other than zero. `0px` needs no rung. */
const PX = /-?\d*\.?\d+px\b/g;
function nonZeroPx(value: string): string[] {
  return (value.match(PX) ?? []).filter((hit) => Number.parseFloat(hit) !== 0);
}

/**
 * Durations and easings inside a transition/animation value.
 *
 * `0s` and `0ms` are excluded for the same reason `0px` is: there is no zero
 * rung. `!important` is stripped first so the reduced-motion damper in
 * global.css, which is a documented override rather than a styling choice,
 * reads as the `0.01ms` it is and gets counted once.
 */
const DURATION = /-?\d*\.?\d+m?s\b/g;
const EASING_KEYWORD =
  /\b(?:ease-in-out|ease-in|ease-out|ease|linear|step-end|step-start)\b/g;
const EASING_FUNCTION = /(?:cubic-bezier|steps)\([^)]*\)/g;

function motionHits(value: string): string[] {
  const cleaned = value.replace(/!important/g, " ");
  const durations = (cleaned.match(DURATION) ?? []).filter(
    (hit) => Number.parseFloat(hit) !== 0,
  );
  return [
    ...durations,
    ...(cleaned.match(EASING_FUNCTION) ?? []),
    ...(cleaned.match(EASING_KEYWORD) ?? []),
  ];
}

/** A value that is nothing but a bare number, once quotes and commas go. */
function bareNumber(value: string): string | undefined {
  const trimmed = value.replace(/["'`,;]/g, "").trim();
  return /^-?\d*\.?\d+$/.test(trimmed) ? trimmed : undefined;
}

const FAMILIES: Record<Family, FamilySpec> = {
  spacing: {
    label: "spacing",
    properties: [
      "padding",
      "padding-top",
      "padding-right",
      "padding-bottom",
      "padding-left",
      "padding-inline",
      "padding-block",
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "paddingInline",
      "paddingBlock",
      "margin",
      "margin-top",
      "margin-right",
      "margin-bottom",
      "margin-left",
      "margin-inline",
      "margin-block",
      "marginTop",
      "marginRight",
      "marginBottom",
      "marginLeft",
      "marginInline",
      "marginBlock",
      "gap",
      "row-gap",
      "column-gap",
      "rowGap",
      "columnGap",
    ],
    remedy: "use a --space-* rung (hair/2/4/6/8/10/12/16/24; 8 is the default)",
    hits: nonZeroPx,
    plants: [
      { shape: "css", source: "  padding: 7px 13px;" },
      { shape: "style object", source: '  paddingTop: "7px",' },
    ],
  },
  radius: {
    label: "radius",
    properties: [
      "border-radius",
      "borderRadius",
      "border-top-left-radius",
      "border-top-right-radius",
      "border-bottom-left-radius",
      "border-bottom-right-radius",
      "borderTopLeftRadius",
      "borderTopRightRadius",
      "borderBottomLeftRadius",
      "borderBottomRightRadius",
    ],
    remedy:
      "use --radius-regular for an ordinary corner and --radius-floating for a box above the app, or --radius-pill for a stadium and --radius-circle for a circle (never a hand-computed half-height). --radius-display-frame belongs to FramedDisplay alone",
    hits: (value) => [
      ...nonZeroPx(value),
      ...(value.match(/\b\d*\.?\d+%/g) ?? []),
    ],
    plants: [
      { shape: "css", source: "  border-radius: 9px;" },
      { shape: "style object", source: '  borderRadius: "9px",' },
    ],
  },
  fontSize: {
    label: "font-size",
    properties: ["font-size", "fontSize"],
    remedy: "use --font-size-2xs/xs/sm/base/lg",
    hits: nonZeroPx,
    plants: [
      { shape: "css", source: "  font-size: 13px;" },
      { shape: "style object", source: '  fontSize: "13px",' },
    ],
  },
  lineHeight: {
    label: "line-height",
    properties: ["line-height", "lineHeight"],
    remedy:
      "use --line-height-flush/tight/body/prose (they are named by role, not by number)",
    hits: (value) => {
      const bare = bareNumber(value);
      return bare === undefined ? nonZeroPx(value) : [bare];
    },
    plants: [
      { shape: "css", source: "  line-height: 1.27;" },
      { shape: "style object", source: "  lineHeight: 1.27," },
    ],
  },
  zIndex: {
    label: "z-index",
    properties: ["z-index", "zIndex"],
    remedy:
      "use --z-base/sticky/dropdown/overlay/fab/backdrop/modal/toast/critical if the layer is app-global chrome; if it is local sibling ordering inside one component's stacking context, keep the literal and say so in a comment, then raise this baseline",
    hits: (value) => {
      const bare = bareNumber(value);
      return bare === undefined ? [] : [bare];
    },
    plants: [
      { shape: "css", source: "  z-index: 37;" },
      { shape: "style object", source: "  zIndex: 37," },
    ],
  },
  motion: {
    label: "motion",
    properties: [
      "transition",
      "transition-duration",
      "transition-delay",
      "transition-timing-function",
      "transitionDuration",
      "transitionDelay",
      "transitionTimingFunction",
      "animation",
      "animation-duration",
      "animation-delay",
      "animation-timing-function",
      "animationDuration",
      "animationDelay",
      "animationTimingFunction",
    ],
    remedy:
      "use --duration-instant/fast/base/slow/entrance and --ease-standard/emphasis/linear/entrance; if the duration encodes something physical (a sample cadence, a 1Hz caret, an indicator whose period the operator reads) keep the literal, say so in a comment, and raise this baseline",
    hits: motionHits,
    plants: [
      { shape: "css", source: "  transition: opacity 220ms ease-in;" },
      { shape: "style object", source: '  transitionDuration: "220ms",' },
    ],
  },
};

interface Offender {
  file: string;
  line: number;
  property: string;
  value: string;
  hit: string;
}

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

/** Blank a comment out, keeping its newlines so line numbers stay true. */
function blankOut(match: string): string {
  return match.replace(/[^\n]/g, " ");
}

/**
 * Strip block and line comments. The migration left a comment beside
 * nearly every literal it declined to move, and those comments quote the
 * values ("6px 14px", "(4 - 14) / 2"); counting prose about a value as
 * the value itself would make the baseline meaningless and would punish
 * exactly the documentation we want.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blankOut)
    .replace(
      /(^|[^:"'`\\])\/\/[^\n]*/g,
      (match, lead: string) => lead + " ".repeat(match.length - lead.length),
    );
}

/** Remove `var(...)` and `env(...)`, innermost first, so their fallbacks do not read as literals. */
function stripFunctionalFallbacks(value: string): string {
  let out = value;
  let previous: string;
  do {
    previous = out;
    out = out.replace(/(?:var|env)\(\s*[\w-]+\s*(?:,[^()]*)?\)/g, " ");
  } while (out !== previous);
  return out;
}

function lineIndexer(source: string): (offset: number) => number {
  const starts: number[] = [];
  let cursor = 0;
  for (const line of source.split("\n")) {
    starts.push(cursor);
    cursor += line.length + 1;
  }
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/**
 * One declaration matcher per family. The leading class rules out
 * `scrollPadding`, `--scroll-glow-pad-x` and `theme.gap`; the properties
 * are sorted longest-first so `paddingLeft:` cannot be read as
 * `padding`. The value runs to the next `;`, `}` or newline, which is
 * why a declaration split across lines only has its first line checked
 * (the migration hand-migrated those; both halves being literal is the
 * case the baseline covers).
 */
function declarationMatcher(spec: FamilySpec): RegExp {
  const alternation = [...spec.properties]
    .sort((a, b) => b.length - a.length)
    .join("|");
  return new RegExp(`(^|[^\\w$.\\-])(${alternation})\\s*:\\s*([^;}\\n]*)`, "g");
}

const MATCHERS = Object.fromEntries(
  Object.entries(FAMILIES).map(([family, spec]) => [
    family,
    declarationMatcher(spec),
  ]),
) as Record<Family, RegExp>;

function isExcused(file: string, family: Family): boolean {
  return EXCEPTIONS.some(
    (entry) =>
      entry.path === file &&
      (entry.families === "all" || entry.families.includes(family)),
  );
}

/**
 * Enumerate git-TRACKED sources under the scan roots. Same reasoning as
 * `styleguide-cleanup.test.ts`: a live filesystem walk races with the
 * dist output and temp fixtures other packages write during a
 * concurrent `turbo test`, so the count flickers; the git index does not
 * move mid-run.
 */
function trackedSources(): string[] {
  const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  return execFileSync(
    "git",
    ["ls-files", "-z", "--", ...styleguideScanRoots(root)],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\0")
    .filter(
      (rel) =>
        /\.(tsx?|css)$/.test(rel) &&
        !/\.test\.|\.test-d\./.test(rel) &&
        !rel.includes("/__generated__/") &&
        !rel.includes("/__snapshots__/"),
    );
}

function collectOffenders(): Record<Family, Offender[]> {
  const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  const offenders = Object.fromEntries(
    Object.keys(FAMILIES).map((family) => [family, [] as Offender[]]),
  ) as Record<Family, Offender[]>;

  for (const rel of trackedSources()) {
    let raw: string;
    try {
      raw = readFileSync(join(root, rel), "utf8");
    } catch {
      continue;
    }
    const source = stripComments(raw);
    const lineOf = lineIndexer(source);
    for (const [family, spec] of Object.entries(FAMILIES) as [
      Family,
      FamilySpec,
    ][]) {
      if (isExcused(rel, family)) continue;
      const matcher = new RegExp(MATCHERS[family].source, "g");
      for (const match of source.matchAll(matcher)) {
        const value = match[3];
        for (const hit of spec.hits(
          stripFunctionalFallbacks(value),
          match[2],
        )) {
          offenders[family].push({
            file: rel,
            line: lineOf(match.index),
            property: match[2],
            value: value.trim().slice(0, 72),
            hit,
          });
        }
      }
    }
  }
  return offenders;
}

const OFFENDERS = collectOffenders();

function assertFamily(family: Family): void {
  const spec = FAMILIES[family];
  const baseline = BASELINES[family];
  const offenders = OFFENDERS[family];

  const byFile = new Map<string, Offender[]>();
  for (const o of offenders) {
    const key = baselineKey(o.file);
    const list = byFile.get(key) ?? [];
    list.push(o);
    byFile.set(key, list);
  }

  // A file's offenders beyond its allowance are the new ones. Sites within
  // the allowance are the documented survivors, so which of a file's N sites
  // counts as "new" is arbitrary, but the FILE is named correctly, which is
  // the part an author needs.
  const added: Offender[] = [];
  for (const [file, list] of byFile) {
    const allowed = baseline[file] ?? 0;
    if (list.length > allowed) added.push(...list.slice(allowed));
  }

  if (added.length > 0) {
    const detail = added
      .map(
        (o) => `  ${o.file}:${o.line}  ${o.property}: ${o.value}  [${o.hit}]`,
      )
      .join("\n");
    throw new Error(
      `${added.length} new hardcoded ${spec.label} value(s):\n${detail}\n` +
        `Instead, ${spec.remedy}. The ladders, the semantic names over them ` +
        `and the rule for picking either are in packages/theme/src/tokens.css.\n` +
        `If the value genuinely cannot sit on the ladder, comment WHY at the ` +
        `call site and then add or raise that file's entry in ` +
        `BASELINES.${family} in packages/core/src/styleguide-tokens.test.ts, ` +
        `or add the file to EXCEPTIONS there with a reason.`,
    );
  }

  // A count below its baseline fails as one above it does: slack is permission
  // for that many new literals. Reported per file, because that is what the
  // author has to edit.
  const cleaned: string[] = [];
  for (const [file, allowed] of Object.entries(baseline)) {
    const now = byFile.get(file)?.length ?? 0;
    if (now < allowed) {
      cleaned.push(
        `  ${file}: ${allowed} -> ${now}${now === 0 ? " (remove the key)" : ""}`,
      );
    }
  }
  if (cleaned.length > 0) {
    throw new Error(
      `The ${spec.label} baseline sits above what the tree carries:\n${cleaned.join("\n")}\n` +
        `That slack is permission for the same number of new literals, which is ` +
        `why this fails instead of warning. Lower each entry to the count shown, ` +
        `or delete the key, in BASELINES.${family} in ` +
        `packages/core/src/styleguide-tokens.test.ts.`,
    );
  }

  expect(added).toEqual([]);
}

describe("design-system: hardcoded design-token values", () => {
  it("holds the spacing baseline (padding, margin, gap)", () => {
    assertFamily("spacing");
  });

  it("holds the radius baseline", () => {
    assertFamily("radius");
  });

  it("holds the font-size baseline", () => {
    assertFamily("fontSize");
  });

  it("holds the line-height baseline", () => {
    assertFamily("lineHeight");
  });

  it("holds the z-index baseline", () => {
    assertFamily("zIndex");
  });

  it("holds the motion baseline (transitions and animations)", () => {
    assertFamily("motion");
  });

  // A guard that scans nothing passes forever. If the roots, the git
  // pathspec or the extension filter ever break, every baseline silently
  // becomes unreachable and this is the only test that notices.
  it("actually scanned the tree", () => {
    const total = Object.values(OFFENDERS).reduce(
      (sum, list) => sum + list.length,
      0,
    );
    expect(total).toBeGreaterThan(0);
  });
});

/**
 * "Scanned the tree" is not the same as "can still see an offence". A family
 * whose property list or value regex drifts out of step with how the code is
 * written finds nothing, reports nothing, and reads as a clean tree forever.
 * So every run plants one violation per
 * family through the same matcher and the same `hits` the scan uses, and fails
 * as BLIND rather than green when a plant comes back unseen.
 *
 * Per family and per SHAPE, because the two shapes the app writes travel
 * through different code and a css plant grades only one of them. See the
 * `plants` field for what a single css plant failed to notice.
 */
describe("design-system: the ratchet can see a violation", () => {
  for (const [family, spec] of Object.entries(FAMILIES) as [
    Family,
    FamilySpec,
  ][]) {
    for (const plant of spec.plants) {
      it(`catches a planted ${spec.label} violation in a ${plant.shape}`, () => {
        const planted: string[] = [];
        const matcher = new RegExp(MATCHERS[family].source, "g");
        for (const match of stripComments(plant.source).matchAll(matcher)) {
          planted.push(
            ...spec.hits(stripFunctionalFallbacks(match[3]), match[2]),
          );
        }
        expect(
          planted,
          `the ${spec.label} scan is BLIND to a ${plant.shape}: it found ` +
            `nothing in ${JSON.stringify(plant.source)}, so a zero from it ` +
            `says nothing about the tree`,
        ).not.toEqual([]);
      });
    }
  }

  // A shape that stops being planted is a hole that reopens silently, so the
  // count is asserted rather than left to whoever edits FAMILIES next.
  it("plants both shapes for every family", () => {
    for (const [family, spec] of Object.entries(FAMILIES) as [
      Family,
      FamilySpec,
    ][]) {
      expect(
        spec.plants.map((p) => p.shape).sort(),
        `${family} must plant a css declaration AND a JS style object`,
      ).toEqual(["css", "style object"]);
    }
  });
});

/**
 * The semantic spacing names, and the two ways reading one can go wrong.
 *
 * `styleguide-token-refs.test.ts` counts a name declared anywhere in the
 * scanned source as declared, which would let a `--gap-related` declared only
 * on `Card.tsx` pass while every page not inside a card resolves it to nothing
 * and collapses its gap to zero. So a spacing name has to be declared in
 * `tokens.css`, at `:root`, and this checks that specifically.
 *
 * The second is shape. An `--inset-*` of two or more values is an ordered
 * vertical/horizontal list, so it is only correct in the `padding` shorthand:
 * in `padding-left` it expands to several values on one edge, and in
 * `padding-inline` it lands transposed. A single-valued inset is a length and
 * reads anywhere a length does.
 */
describe("design-system: the semantic spacing vocabulary", () => {
  const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  const TOKENS_CSS = "packages/theme/src/tokens.css";
  const tokens = stripComments(readFileSync(join(root, TOKENS_CSS), "utf8"));
  const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(tokens)?.[1] ?? "";
  const SPACING_NAME =
    /^\s*(--(?:gap|inset|outset|gutter|indent|offset)-[a-z0-9-]+)\s*:\s*([^;]+);/gm;
  const DECLARED = new Map(
    [...rootBlock.matchAll(SPACING_NAME)].map((m) => [m[1], m[2].trim()]),
  );

  /** How many space-separated values a declaration holds, `var()` kept whole. */
  function valueCount(value: string): number {
    let depth = 0;
    let count = 0;
    let inValue = false;
    for (const character of value) {
      if (character === "(") depth += 1;
      if (character === ")") depth -= 1;
      if (depth === 0 && /\s/.test(character)) {
        inValue = false;
        continue;
      }
      if (!inValue) count += 1;
      inValue = true;
    }
    return count;
  }

  it("found the vocabulary it checks against", () => {
    expect(DECLARED.get("--gap-related")).toBeDefined();
    expect(valueCount(DECLARED.get("--inset-surface") ?? "")).toBe(2);
    expect(valueCount(DECLARED.get("--inset-popover") ?? "")).toBe(1);
  });

  it("uses no semantic spacing name that tokens.css does not declare at :root", () => {
    const used = new Set<string>();
    for (const rel of trackedSources()) {
      const source = stripComments(readFileSync(join(root, rel), "utf8"));
      for (const match of source.matchAll(
        /var\(\s*(--(?:gap|inset|outset|gutter|indent|offset)-[a-z0-9-]+)/g,
      )) {
        used.add(match[1]);
      }
    }
    const undeclared = [...used].filter((name) => !DECLARED.has(name));
    expect(
      undeclared,
      `${undeclared.join(", ")} is read but not declared at :root in ` +
        `${TOKENS_CSS}. Outside a container that declares it, it resolves to ` +
        `nothing. Declare it in the SEMANTIC SPACING block.`,
    ).toEqual([]);
  });

  it("reads a multi-value --inset-* only in the padding shorthand", () => {
    const misuse: string[] = [];
    for (const rel of trackedSources()) {
      if (rel === TOKENS_CSS) continue;
      const source = stripComments(readFileSync(join(root, rel), "utf8"));
      const lineOf = lineIndexer(source);
      for (const match of source.matchAll(/var\(\s*(--inset-[a-z0-9-]+)/g)) {
        if (valueCount(DECLARED.get(match[1]) ?? "") < 2) continue;
        const declaration = source.slice(
          Math.max(0, match.index - 200),
          match.index,
        );
        if (/(?:^|[^\w$.-])padding\s*:[^;]*$/.test(declaration)) continue;
        misuse.push(`  ${rel}:${lineOf(match.index)}  ${match[0]}`);
      }
    }
    expect(
      misuse,
      `a multi-value --inset-* is an ordered vertical/horizontal list:\n${misuse.join(
        "\n",
      )}\nIn padding-inline it lands transposed and on a single side it ` +
        `expands to several values on one edge. Use the padding shorthand, or ` +
        `name the one edge's job as its own single-valued token.`,
    ).toEqual([]);
  });

  it("can see a multi-value inset outside the padding shorthand", () => {
    const pair = [...DECLARED].find(([, value]) => valueCount(value) >= 2);
    expect(pair).toBeDefined();
    const planted = `  padding-inline: var(${pair?.[0]});`;
    const declaration = planted.slice(0, planted.indexOf("var("));
    expect(/(?:^|[^\w$.-])padding\s*:[^;]*$/.test(declaration)).toBe(false);
  });
});

describe("design-system: token-ratchet exceptions", () => {
  it("gives every exception a substantive reason", () => {
    for (const entry of EXCEPTIONS) {
      expect(
        entry.reason.trim().length,
        `${entry.path} is excused from the ${
          entry.families === "all" ? "token" : entry.families.join("/")
        } ratchet with no real reason`,
      ).toBeGreaterThan(40);
    }
  });

  it("excuses no path that has moved or been deleted", () => {
    const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
    const stale = EXCEPTIONS.filter(
      (entry) => !existsSync(join(root, entry.path)),
    ).map((entry) => entry.path);
    expect(stale).toEqual([]);
  });
});
