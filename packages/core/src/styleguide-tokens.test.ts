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
 * The route for a new value is: pick the rung from the ladder in
 * `packages/theme/src/tokens.css` (the comments there say which rung
 * does which job) and write `var(--space-8)` and friends. If no rung
 * fits, the value is telling you something about the design, not about
 * the scale: say so in a comment at the call site and raise the
 * baseline, or add an EXCEPTIONS entry if the whole file is off-ladder.
 *
 * What this scan deliberately does NOT flag:
 *   - `0` and `0px`. There is no zero rung and there should not be one.
 *   - `rem` / `em` / `%` / `ch` / viewport and container units. These are
 *     relative by intent (the two `rem` clusters in the app are sized
 *     against the browser font size on purpose, an accessibility
 *     property a px token would destroy). The ladders are px ladders.
 *   - values inside `var(...)` or `env(...)`, so the ui-kit convention of
 *     `var(--space-8, 8px)` fallbacks reads as a token reference, which
 *     is what it is.
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

/**
 * The seventh family is a different KIND of offence and belongs here anyway.
 *
 * The six above fail a raw number where a token exists. `rawSpacingRung` fails
 * a raw RUNG (`gap: var(--space-8)`) where a semantic name exists, because the
 * ladder answers "which number" and the app's complaint was never the numbers:
 * the three commonest gap rungs sit at roughly 110 declarations each, three
 * rungs doing one job. `--gap-related` and its siblings answer "which job", and
 * they inherit, so a container can change what a job means for everything
 * inside it. See the SEMANTIC SPACING block in `packages/theme/src/tokens.css`.
 *
 * It is scoped by DIRECTORY rather than by judgement. `packages/ui-kit/src` and
 * `packages/theme/src` keep their rungs because the semantic layer is DEFINED
 * in terms of them: `--gap-related: var(--space-8)` is the answer, not the
 * offence, and a kit primitive declaring a tier has to name a rung to do it.
 * Everywhere else the ratchets already scan is in scope, which is a superset of
 * the widget packages and means a new package is covered the day it lands
 * rather than the day someone remembers to add it.
 *
 * It counts only the declaration shapes the vocabulary can actually express: a
 * single-valued gap on a rung other than `hair`, and a two-value `padding`
 * whose halves are both rungs. That exclusion is load-bearing rather than a
 * convenience. A uniform `padding: var(--space-8)`, a three-value one, a
 * single-side one, any `margin` and an asymmetric `gap: A B` have NO semantic
 * name to move to, on purpose (tokens.css says why), so counting them would
 * seed a shrink-only debt over a population with nowhere to shrink to.
 * Measured on the tree the seed was taken from: 1,206 rung references sit in a
 * spacing declaration, 680 of them in an expressible shape, 568 of those
 * outside the two excluded roots. Two were migrated in the same change, so the
 * table below started at 566. Under half of the app's spacing will ever carry
 * a semantic name, and a ratchet that pretended otherwise would be
 * permanently, unfixably red.
 *
 * SHAPE is not the same as VALUE, and the first migration tranche found the
 * difference. Three value families sit in an expressible shape and still have
 * no honest name, so they will not reach zero and an entry covering one should
 * not be read as unfinished work:
 *
 *   - `gap: var(--space-10)`. 10 is the one rung with no gap name over it:
 *     --gap-related is 8 and --gap-section is 16, so aliasing it either
 *     tightens a cluster or opens a hole. 9 sites at the seed.
 *   - The chrome band, `(10,16)`. There WAS a name for it and it was deleted:
 *     it described banners, buttons, cards, list rows and coarse-pointer touch
 *     targets alike, and `PanelBody` did not use it. The 16 is the
 *     cross-package gutter lock the ladder documents, so a site that wants it
 *     names that rung and says why.
 *   - Pairs whose horizontal half is not larger than the vertical, `(12,8)`
 *     and `(6,4)`. Every --inset-* widens faster than it grows, so naming one
 *     transposes it.
 *
 * TWO SHAPES WERE DROPPED FROM THIS FAMILY when the vocabulary went from eight
 * names to five, and they are rule changes rather than debt edits: a shape with
 * no name left is not an offence, and counting one would seed debt that cannot
 * be paid. `rawRungHits` names both at the branch that skips it. Do not restore
 * either without restoring a name for it first.
 */
type Family =
  | "spacing"
  | "radius"
  | "fontSize"
  | "lineHeight"
  | "zIndex"
  | "motion"
  | "rawSpacingRung";

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
    "mod/": 6,
    "packages/app/src/styles/global.css": 1,
    "packages/components/src/CommSignal/index.tsx": 1,
    "packages/components/src/FleetRoster/index.tsx": 2,
    "packages/components/src/MapView/MapPoiLayer.tsx": 2,
    "packages/components/src/Navball/index.tsx": 1,
    "packages/components/src/shared/OrbitalEventChips.tsx": 4,
    "packages/components/src/shared/RequiresGuard.tsx": 3,
    "packages/components/src/StationConnectView/index.tsx": 19,
    "packages/components/src/Strategies/index.tsx": 1,
    "packages/components/src/ThermalStatus/index.tsx": 2,
    "packages/components/src/Twr/index.tsx": 1,
    "packages/data/src/FlightsManager/index.tsx": 2,
    "packages/serial/src/SerialDevicesMenu/ProtocolReferenceModal.tsx": 1,
    "packages/ui-kit/src/Tabs.tsx": 1,
    "packages/ui/src/FileInput.tsx": 1,
    "packages/ui/src/Tabs.tsx": 1,
    "packages/ui/src/VisuallyHidden.tsx": 1,
  },
  /**
   * 9 across 5 files. Four in `StationConnectView` (exempt page), and five
   * hairline or half-height radii deliberately off the four-rung ramp:
   * CommSignal's 1px bar, ActionGroup's focus-ring radius, InputTester's
   * nested pair, OrbitalEventChips' chip.
   */
  radius: {
    "packages/components/src/ActionGroup/index.tsx": 1,
    "packages/components/src/CommSignal/index.tsx": 1,
    "packages/components/src/shared/OrbitalEventChips.tsx": 1,
    "packages/components/src/StationConnectView/index.tsx": 4,
    "packages/serial/src/InputTester/index.tsx": 2,
  },
  /**
   * 60 across 32 files. Two thirds are display-tier sizes above the
   * scale's `lg` ceiling (18/20/22/24/28px readouts) and fluid `clamp()`
   * readouts, both of which the scale stops short of on purpose. The rest
   * are sizes locked into a fixed box or a coarse-pointer calculation
   * (Navball's 9px and 14px terms in a 74px reserve, TechTree's card
   * ladder against CARD_H = 48, Targeting's 11px, PanelStatusDot's
   * 7px pinned under an 11px dot), plus `shared/` and mod widgets no slice
   * owned.
   */
  fontSize: {
    "mod/": 2,
    "packages/app/src/components/ComponentOverlay.tsx": 2,
    "packages/app/src/components/StationConnectionFab.tsx": 1,
    "packages/app/src/components/StationLinkFab.tsx": 1,
    "packages/app/src/goNoGo/GoNoGoComponent.tsx": 5,
    "packages/components/src/CrewStatus/index.tsx": 2,
    "packages/components/src/CurrentOrbit/index.tsx": 2,
    "packages/components/src/FuelStatus/index.tsx": 2,
    "packages/components/src/MapView/MapView.styles.ts": 1,
    "packages/components/src/Navball/AttitudeIndicator.tsx": 3,
    "packages/components/src/Navball/index.tsx": 1,
    "packages/components/src/PowerSystems/index.tsx": 1,
    "packages/components/src/SemiMajorAxis/index.tsx": 1,
    "packages/components/src/shared/OrbitalEventChips.tsx": 2,
    "packages/components/src/shared/RequiresGuard.tsx": 2,
    "packages/components/src/SpaceCenterStatus/index.tsx": 3,
    "packages/components/src/StationConnectView/index.tsx": 7,
    "packages/components/src/SystemView/index.tsx": 1,
    "packages/components/src/Targeting/index.tsx": 3,
    "packages/components/src/TechTree/index.tsx": 5,
    "packages/components/src/Twr/index.tsx": 1,
    "packages/components/src/WarpControl/index.tsx": 1,
    "packages/serial/src/SerialDevicesMenu/CalibrateWizard.tsx": 1,
    "packages/serial/src/SerialDevicesMenu/ProtocolReferenceModal.tsx": 1,
    "packages/serial/src/VirtualDevice/index.tsx": 1,
    "packages/ui-kit/src/Form.tsx": 1,
    "packages/ui-kit/src/Readout.tsx": 3,
    "packages/ui-kit/src/status/PanelStatusDot.tsx": 1,
    "packages/ui/src/FabPrompt.tsx": 1,
  },
  /**
   * 6 across 5 buckets. Values between the four role rungs, each paired with
   * a fixed height or an `em` sibling that would drift if they moved:
   * 1.05 twice, 1.15 twice, 1.3 twice. Two of them are under `mod/`, which
   * shares one bucket.
   */
  lineHeight: {
    "mod/": 2,
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
    // 6th: a mod terminal widget's "change CPU" overlay button, local sibling
    // ordering inside its own frame's stacking context (same as that frame's
    // other badge overlays), commented at the call site. Not app-global chrome,
    // so no named z rung.
    //
    // 7 -> 6: the terminal's delay badge stopped pinning itself and took
    // `ConsoleFrame`'s corner slot, which carries that literal now (below), so
    // both consoles hang the reading in one place.
    "mod/": 6,
    "packages/app/src/components/Dashboard/GridItemContent.tsx": 1,
    "packages/components/src/AtmosphereProfile/index.tsx": 1,
    "packages/components/src/MapView/MapPoiLayer.tsx": 1,
    "packages/components/src/ShipMap/index.tsx": 3,
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
    "packages/ui-kit/src/CommandDelay/PanelDelayRail.tsx": 3,
    // The scroll-shadow edge fade over the tab bar, local sibling ordering
    // inside the tab bar's own stacking context. Not app-global chrome, so
    // no named z rung.
    "packages/ui-kit/src/Tabs.tsx": 1,
    "packages/ui/src/BannerStack.tsx": 1,
    "packages/ui/src/DimmedOverlay.tsx": 1,
    "packages/ui/src/Tabs.tsx": 1,
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
    "mod/": 2,
    "packages/app/src/styles/global.css": 2,
    "packages/components/src/ContractManager/index.tsx": 2,
    "packages/components/src/LaunchDirector/index.tsx": 1,
    "packages/components/src/Navball/AttitudeIndicator.tsx": 2,
    "packages/components/src/Navball/index.tsx": 2,
    "packages/components/src/PerfBudgets/index.tsx": 2,
    "packages/components/src/ShipMap/index.tsx": 2,
    "packages/components/src/SpaceCenterStatus/index.tsx": 1,
    "packages/components/src/Targeting/index.tsx": 2,
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
  /**
   * Seeded at 566 across 107 keys, at the whole tree the day the semantic
   * names landed, less the one widget migrated to prove the mechanism.
   * Unlike every baseline above it, this one is not a list of sites
   * that legitimately stay literal: it is the MIGRATION, written down. Each
   * entry is a file whose gaps and insets still name a rung where they could
   * name a job, and the number is how many. The widget spacing pass shrinks it
   * a widget at a time.
   *
   * It fell 24 net when the vocabulary went from eight names to five, and
   * neither half of that was a widget migrating: 28 declarations stopped being
   * offences because the shape they sat in lost its name (a `hair` gap, and
   * every `margin-left`), and four grew because the four call sites of the
   * deleted --inset-panel went back to rungs rather than tighten. See the
   * comment on those keys below, and the two branches in `rawRungHits`.
   *
   * It then fell 63 when the alarm directory and the whole of `packages/data`
   * went over, which WAS widgets migrating: 63 declarations changed spelling,
   * and 53 of those changed pixel value, 46 up, 6 down and one trading 2px of
   * height for 2px of width. Those are chromium's numbers off the real
   * tokens.css, not arithmetic: jsdom resolves an unknown custom property to
   * 0px and would have reported a collapse as a clean pass. The growth is
   * concentrated in one place and is the point of the exercise: 22 buttons,
   * selects and inputs sat at a 2px or 4px vertical inset and are now on
   * --inset-control, which is the --control-height floor.
   *
   * What those files could NOT say is the (8,16) band: a floating or
   * full-width chrome strip on the 16px gutter lock. That is the same hole the
   * deleted --inset-panel left at (10,16), and it now has seven sites rather
   * than four. Seven is still not a name, because both halves resolve the same
   * in every tier and the pair is a shape the ladder writes fine, so they stay
   * rungs and say why at the declaration.
   *
   * It then fell 64 when the space-centre widgets went over: the tech tree,
   * strategies, contracts, space-centre status, objectives, the fleet roster
   * and the two shared kerbal readouts the astronaut complex draws with. 64
   * declarations changed spelling and 49 of them changed pixel value, 46 up
   * and 3 down, chromium's numbers off the real tokens.css again. The three
   * down are the only two sites in the cohort that were ABOVE a name: a
   * portalled popover and the tech tree's detail panel, both at (8,10) and
   * both --inset-surface, plus the kerbal stat row, whose only two render
   * sites are inside a `Card` and which therefore reads --gap-related as 6.
   * That last one is why the tier has to be resolved rather than assumed: the
   * same token is 8px everywhere else in the cohort.
   *
   * Two sites in it stayed literal and neither is a new family. The tech tree's
   * graph card is a FLOOR conflict, the same shape as the 18px drag headers:
   * its padding is one term of a fixed CARD_H the file already measures as
   * flush, so every --inset-* name draws a box the card has no room for. The
   * strategies screen inset is the (8,16) chrome band at (8,12): a gutter round
   * a box with neither border nor fill, both halves resolving the same in every
   * tier.
   *
   * The cohort unit is the WIDGET, not the declaration. A half-migrated widget
   * can have a converted declaration and its unconverted sibling differ by up
   * to 4px, so a file goes from its seeded number to zero in one landing and
   * this table is the record of which ones have.
   *
   * `mod/` shares one bucket, like the families above, because
   * `uplink-boundary.test.ts` fails the build on any mention of an Uplink
   * outside its owning directory.
   */
  rawSpacingRung: {
    "mod/": 21,
    // Both alarm banners hold their one remaining site on purpose: a floating
    // banner pill at (8,16), which is the same wide-chrome band the four
    // ex-panel sites below hold and which no name covers. Each says so at the
    // declaration.
    "packages/app/src/alarms/AlarmBanner.tsx": 1,
    "packages/app/src/alarms/StationAlarmBanner.tsx": 1,
    /*
     * The widget picker's five: four bands hanging off the overlay's own 16px
     * gutter (one of them a full-width row that is a <button> and still not a
     * control), and an empty state that wants more height than width, which no
     * --inset-* name can say.
     */
    "packages/app/src/components/ComponentOverlay.tsx": 5,
    /*
     * A tile's drag header is 18px on the desktop branch and its glyph buttons
     * are sized to fit it, so --inset-control, which is the other half of
     * --control-height at 28, cannot describe them. The tray gap goes with
     * them: five glyphs ride it and the widget's name has the rest of the row.
     */
    "packages/app/src/components/Dashboard/MobileDashboard.tsx": 2,
    "packages/app/src/components/Dashboard/shared.tsx": 2,
    "packages/app/src/components/Dashboard/WidgetGearMenu.tsx": 1,
    "packages/app/src/components/FlightOutcomeBanner.tsx": 1,
    "packages/app/src/components/SceneChangeBanner.tsx": 1,
    /* The screenshot preview's 10px gap: the one gap rung with no name over
       it, --gap-related being 8 and --gap-section 16. */
    "packages/app/src/logs/LogsManager.tsx": 1,
    /* Three glyphs stacked in PAIRS down the side of a note whose one-line
       body is about as tall as one control inset would make them. */
    "packages/app/src/notes/NotesComponent.tsx": 3,
    "packages/app/src/pushToMain/PushedDashboardOverlay.tsx": 2,
    /*
     * The only real controls in this package still on rungs, and the file says
     * why at length: they are the two states of one chip inside a fixed
     * overlay with a logged history of swallowing clicks meant for the
     * dashboard under it, so the control inset's 8px of height and 12px of
     * width are not free.
     */
    "packages/app/src/stationIdentity/StationNameEditor.tsx": 2,
    "packages/components/src/AtmosphereProfile/index.tsx": 3,
    "packages/components/src/CommSignal/index.tsx": 3,
    "packages/components/src/CurrentOrbit/index.tsx": 1,
    "packages/components/src/DataSourceStatus/index.tsx": 2,
    "packages/components/src/EscapeProfile/index.tsx": 1,
    "packages/components/src/FuelStatus/index.tsx": 4,
    "packages/components/src/Graph/index.tsx": 5,
    "packages/components/src/LandingStatus/index.tsx": 4,
    "packages/components/src/LaunchDirector/index.tsx": 27,
    "packages/components/src/LibrationPoints/index.tsx": 1,
    "packages/components/src/ManeuverPlanner/NodeRow.tsx": 2,
    "packages/components/src/ManeuverPlanner/styles.ts": 1,
    "packages/components/src/MapView/MapPoiLayer.tsx": 3,
    "packages/components/src/MapView/MapView.styles.ts": 6,
    "packages/components/src/Navball/AttitudeIndicator.tsx": 1,
    "packages/components/src/Navball/index.tsx": 11,
    "packages/components/src/OrbitView/index.tsx": 1,
    "packages/components/src/PerfBudgets/index.tsx": 5,
    "packages/components/src/Plots/PlotBoard.tsx": 3,
    "packages/components/src/PowerSystems/index.tsx": 9,
    "packages/components/src/shared/OrbitalEventChips.tsx": 1,
    "packages/components/src/ShipMap/index.tsx": 2,
    "packages/components/src/ShipMap/PartActionMenu.tsx": 1,
    "packages/components/src/ShipMap/ShipDiagram.tsx": 3,
    /* A screen's own gutter at (8,12), the same shape as the (8,16) chrome
       band and failing the earning test the same way: nothing is drawn there,
       both halves resolve identically in every tier, and --inset-surface would
       be a claim about a box that has neither border nor fill. */
    "packages/components/src/Strategies/index.tsx": 1,
    "packages/components/src/SystemView/AlmanacPanel.tsx": 2,
    "packages/components/src/SystemView/index.tsx": 1,
    "packages/components/src/SystemView/SystemDiagram.tsx": 4,
    "packages/components/src/SystemView/VesselInfoPanel.tsx": 2,
    "packages/components/src/Targeting/index.tsx": 1,
    "packages/components/src/TargetPicker/index.tsx": 11,
    /* The graph card, whose padding is one term of a fixed CARD_H of 48 that
       the file already measures as flush. A floor conflict rather than a
       missing name: every --inset-* name draws a taller box than the card has
       room for, so the pair moves only when CARD_H does. */
    "packages/components/src/TechTree/index.tsx": 1,
    "packages/components/src/ThermalStatus/index.tsx": 3,
    "packages/components/src/TransferWindow/index.tsx": 16,
    "packages/components/src/WarpControl/index.tsx": 5,
    // One site each, both written up at the declaration. ThStar wants
    // horizontal BELOW vertical, and the replay strip is on the (8,16) band.
    "packages/data/src/FlightsManager/index.tsx": 1,
    "packages/data/src/replaySession/ReplaySessionBanner.tsx": 1,
    "packages/serial/src/InputMappingTab.tsx": 1,
    "packages/serial/src/SerialDevicesMenu/GamepadLearnWizard.tsx": 1,
    // The two below and SourceOfflineBanner.tsx at the end GREW by four in
    // total when the vocabulary went from eight names to five, which is the
    // only growth in this table and is deliberate. They hold the four call
    // sites of the deleted --inset-panel: a floating banner, a menu banner and
    // a modal's header and body, all at (10,16). Nothing names that pair now,
    // and the alternative was to take them to --inset-surface, which would have
    // tightened four visible chrome surfaces by (-4,-8) to make a ratchet
    // number smaller. Each site carries the reason at its own declaration, and
    // the 16 is the cross-package gutter lock the ladder documents.
    "packages/serial/src/SerialDevicesMenu/index.tsx": 2,
    "packages/serial/src/SerialDevicesMenu/ProtocolReferenceModal.tsx": 3,
    "packages/ui/src/BannerPill.tsx": 4,
    "packages/ui/src/DataKeyMultiPicker.tsx": 1,
    "packages/ui/src/DimmedOverlay.tsx": 1,
    "packages/ui/src/Fab.tsx": 1,
    "packages/ui/src/FileInput.tsx": 2,
    "packages/ui/src/SourceOfflineBanner.tsx": 1,
  },
};

interface FamilySpec {
  /** Human label for the failure message. */
  label: string;
  /** CSS properties and JS style keys this family owns. */
  properties: string[];
  /** What to write instead. */
  remedy: string;
  /**
   * What a new site IS, singular, for the failure message. Defaults to
   * "hardcoded <label> value", which is right for the six literal families and
   * wrong for `rawSpacingRung`, whose offence is a token reference.
   */
  offence?: string;
  /** Offending literals inside an already-var-stripped value. */
  hits: (value: string, property: string) => string[];
  /**
   * Read the declaration's raw text instead of the var-stripped one. Only
   * `rawSpacingRung` wants this: the token reference IS the offence there,
   * so stripping it first would leave nothing to find.
   */
  readsRaw?: boolean;
  /** Path prefixes this family does not apply to, each with why. */
  excludedRoots?: { prefix: string; reason: string }[];
  /**
   * Source text this family MUST find a hit in. A regex that stops matching
   * reports zero offenders and zero reads as a clean tree, so every run plants
   * this and fails as blind if the scan cannot see it.
   */
  plant: string;
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

/**
 * The two axes the semantic names cover, keyed by the property that declares
 * each. `padding-inline` is deliberately absent from the inset axis: an
 * `--inset-*` is an ordered vertical/horizontal pair and `padding-inline`
 * would read it transposed.
 *
 * There was a third, `margin-left`, against an `--indent-step` token. Both are
 * gone. The token had zero call sites and the wrong value for 18 of its 19
 * candidates: one real 16px hierarchy indent, and 18 nudges of 2 to 6px pushing
 * a badge or a unit off the text beside it, which are gaps written as margins
 * because the parent is not a flex box. Scanning the axis with no name to move
 * to would have been debt that could not be paid, so the axis went with the
 * name rather than the entries being edited down.
 */
const GAP_PROPERTIES = ["gap", "row-gap", "column-gap", "rowGap", "columnGap"];
const INSET_PROPERTIES = ["padding"];

/** A value that is a single `--space-*` reference and nothing else. */
const LONE_RUNG = /^var\(\s*(--space-[a-z0-9]+)\s*(?:,[^()]*)?\)$/;

/**
 * Drop the punctuation a JS style object wraps its value in.
 *
 * `gap: "var(--space-4)",` in a `CSSProperties` literal is the same
 * declaration as `gap: var(--space-4);` in a template literal, and the app
 * writes both. Without this the quotes and the trailing comma made the value
 * fail an exact-match test and the whole inline-style population read as
 * clean, which is how a Navball gap sat outside the seed.
 */
function unquoteValue(value: string): string {
  return value
    .replace(/["'`]/g, " ")
    .trim()
    .replace(/[,;]+$/, "")
    .trim();
}

/** Split a CSS value on top-level whitespace, keeping `var(a, b)` whole. */
function topLevelValues(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of value.trim()) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth === 0 && /\s/.test(character)) {
      if (current) out.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (current) out.push(current);
  return out;
}

/**
 * A rung reference in a declaration shape a semantic name can express.
 *
 * Everything else returns nothing, which is the honest half of this family:
 * a `calc()` bleed, a uniform or three-value or single-side padding, any
 * `margin`, a two-value padding with a `0` half and an asymmetric `gap: A B`
 * all have no name to move to, so counting them would be seeding debt that can
 * never be paid.
 */
function rawRungHits(rawValue: string, property: string): string[] {
  const value = unquoteValue(rawValue);
  if (value.includes("calc(")) return [];
  const parts = topLevelValues(value);
  const rung = (part: string) => LONE_RUNG.exec(part)?.[1];

  if (GAP_PROPERTIES.includes(property) && parts.length === 1) {
    const only = rung(parts[0]);
    // A 1px gap is not an offence, and this is a rule rather than a debt
    // entry: there was a --gap-hairline over this rung and it was deleted for
    // resolving to 1px in every tier that will ever exist, which is a constant
    // with two spellings rather than a semantic layer. Nothing names `hair`
    // now, so nothing here can be migrated. Restoring the check means
    // restoring a name first. See the SEMANTIC SPACING block in tokens.css.
    if (only === "--space-hair") return [];
    return only ? [`${only} -> --gap-*`] : [];
  }
  if (INSET_PROPERTIES.includes(property) && parts.length === 2) {
    const [vertical, horizontal] = parts.map(rung);
    return vertical && horizontal
      ? [`${vertical} ${horizontal} -> --inset-*`]
      : [];
  }
  return [];
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
    plant: "  padding: 7px 13px;",
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
      "use --radius-xs/sm/md/lg, or --radius-pill for a stadium and --radius-circle for a circle (never a hand-computed half-height)",
    hits: (value) => [
      ...nonZeroPx(value),
      ...(value.match(/\b\d*\.?\d+%/g) ?? []),
    ],
    plant: "  border-radius: 9px;",
  },
  fontSize: {
    label: "font-size",
    properties: ["font-size", "fontSize"],
    remedy: "use --font-size-2xs/xs/sm/base/lg",
    hits: nonZeroPx,
    plant: "  font-size: 13px;",
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
    plant: "  line-height: 1.27;",
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
    plant: "  z-index: 37;",
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
    plant: "  transition: opacity 220ms ease-in;",
  },
  rawSpacingRung: {
    label: "raw spacing rung",
    offence: "raw spacing rung(s) in a shape a semantic name covers",
    properties: [...GAP_PROPERTIES, ...INSET_PROPERTIES],
    remedy:
      "name the JOB instead: --gap-related between siblings of the same kind (the default) and --gap-section between groups of different kinds, --inset-chip/control/surface inside an edge. The rungs stay right for every shape those five names cannot express, which tokens.css lists",
    readsRaw: true,
    excludedRoots: [
      {
        prefix: "packages/theme/src",
        reason:
          "Where the semantic names are declared. `--gap-related: var(--space-8)` is the answer to this ratchet, not an instance of it.",
      },
      {
        prefix: "packages/ui-kit/src",
        reason:
          "The kit declares the density tiers, and a tier is a statement about which rung a job resolves to inside a container, so it can only be written in rungs. The kit also carries the `var(--space-8, 8px)` no-sheet fallback contract, which a semantic name cannot express in one level.",
      },
    ],
    hits: rawRungHits,
    plant: "  gap: var(--space-8);",
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
      if (spec.excludedRoots?.some((root) => rel.startsWith(root.prefix)))
        continue;
      const matcher = new RegExp(MATCHERS[family].source, "g");
      for (const match of source.matchAll(matcher)) {
        const value = match[3];
        const readable = spec.readsRaw
          ? value
          : stripFunctionalFallbacks(value);
        for (const hit of spec.hits(readable, match[2])) {
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
      `${added.length} new ${spec.offence ?? `hardcoded ${spec.label} value(s)`}:\n${detail}\n` +
        `Instead, ${spec.remedy}. The ladders, the semantic names over them ` +
        `and the rule for picking either are in packages/theme/src/tokens.css.\n` +
        `If the value genuinely cannot sit on the ladder, comment WHY at the ` +
        `call site and then add or raise that file's entry in ` +
        `BASELINES.${family} in packages/core/src/styleguide-tokens.test.ts, ` +
        `or add the file to EXCEPTIONS there with a reason.`,
    );
  }

  // Cleanups warn rather than fail, so removing a literal lands green. Report
  // per file, because that is what the author has to edit.
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
    console.warn(
      `[styleguide] ${spec.label} baseline can be lowered in ` +
        `packages/core/src/styleguide-tokens.test.ts:\n${cleaned.join("\n")}`,
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

  it("holds the raw-spacing-rung baseline (gap, inset)", () => {
    assertFamily("rawSpacingRung");
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
 * written finds nothing, reports nothing, and reads as a clean tree forever;
 * `rawSpacingRung` is the most exposed, because it matches a token reference
 * that a rename would quietly change. So every run plants one violation per
 * family through the same matcher and the same `hits` the scan uses, and fails
 * as BLIND rather than green when a plant comes back unseen.
 */
describe("design-system: the ratchet can see a violation", () => {
  for (const [family, spec] of Object.entries(FAMILIES) as [
    Family,
    FamilySpec,
  ][]) {
    it(`catches a planted ${spec.label} violation`, () => {
      const planted: string[] = [];
      const matcher = new RegExp(MATCHERS[family].source, "g");
      for (const match of stripComments(spec.plant).matchAll(matcher)) {
        const value = match[3];
        const readable = spec.readsRaw
          ? value
          : stripFunctionalFallbacks(value);
        planted.push(...spec.hits(readable, match[2]));
      }
      expect(
        planted,
        `the ${spec.label} scan is BLIND: it found nothing in ${JSON.stringify(
          spec.plant,
        )}, so a zero from it says nothing about the tree`,
      ).not.toEqual([]);
    });
  }
});

/**
 * The semantic names, and the two ways a vocabulary can be satisfied by the
 * wrong thing.
 *
 * `styleguide-token-refs.test.ts` documents that any name declared anywhere in
 * the scanned source counts as declared, which would let a `--gap-related`
 * declared only on `Card.tsx` pass while every page that is not inside a card
 * resolves it to nothing and collapses its gap to zero. So the declaration has
 * to be in `tokens.css`, at `:root`, and this checks that specifically.
 *
 * The second is shape. An `--inset-*` is an ordered vertical/horizontal PAIR,
 * so it is only correct in the `padding` shorthand: in `padding-left` it
 * expands to two values on one edge, and in `padding-inline` it lands
 * transposed. That has no baseline because nothing in the tree does it and
 * nothing should start.
 *
 * The list is FIVE, down from eight, and the size is the point: a name earns
 * this mechanism only by resolving differently in different contexts or by
 * expressing a shape the ladder cannot. The three that went were a 1px
 * constant, a size one rung below `related` in every tier, and a 16px indent
 * with no call sites; tokens.css records each. Adding a sixth is a design
 * decision, so this list is the place it has to be argued.
 */
describe("design-system: the semantic spacing vocabulary", () => {
  const VOCABULARY = [
    "--gap-related",
    "--gap-section",
    "--inset-chip",
    "--inset-control",
    "--inset-surface",
  ];

  const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  const TOKENS_CSS = "packages/theme/src/tokens.css";
  const tokens = readFileSync(join(root, TOKENS_CSS), "utf8");
  const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(tokens)?.[1] ?? "";

  it("declares every name at :root in tokens.css", () => {
    const missing = VOCABULARY.filter(
      (name) => !new RegExp(`^\\s*${name}\\s*:`, "m").test(rootBlock),
    );
    expect(
      missing,
      `${missing.join(", ")} would resolve to nothing outside a container that ` +
        `overrides it, which for a gap is a silently collapsed layout. Declare ` +
        `them in the SEMANTIC SPACING block of ${TOKENS_CSS}.`,
    ).toEqual([]);
  });

  it("uses no semantic spacing name that tokens.css does not declare", () => {
    const used = new Set<string>();
    for (const rel of trackedSources()) {
      const source = stripComments(readFileSync(join(root, rel), "utf8"));
      for (const match of source.matchAll(
        /var\(\s*(--(?:gap|inset|indent)-[a-z0-9-]+)/g,
      )) {
        used.add(match[1]);
      }
    }
    const undeclared = [...used].filter((name) => !VOCABULARY.includes(name));
    expect(
      undeclared,
      `${undeclared.join(", ")} is referenced but is not part of the ` +
        `vocabulary declared in ${TOKENS_CSS}. Every new density name needs a ` +
        `written reason there, or the vocabulary problem these names were ` +
        `built to fix comes back wearing a different hat.`,
    ).toEqual([]);
  });

  it("reaches for an --inset-* only in the padding shorthand", () => {
    const misuse: string[] = [];
    for (const rel of trackedSources()) {
      if (rel === TOKENS_CSS) continue;
      const source = stripComments(readFileSync(join(root, rel), "utf8"));
      const lineOf = lineIndexer(source);
      for (const match of source.matchAll(/var\(\s*--inset-[a-z0-9-]+/g)) {
        const declaration = source.slice(
          Math.max(0, match.index - 200),
          match.index,
        );
        if (/(?:^|[^\w$.-])padding\s*:\s*[^;}\n]*$/.test(declaration)) continue;
        misuse.push(`  ${rel}:${lineOf(match.index)}  ${match[0]}`);
      }
    }
    expect(
      misuse,
      `an --inset-* is an ordered vertical/horizontal pair:\n${misuse.join(
        "\n",
      )}\nIn padding-inline it lands transposed and on a single side it ` +
        `expands to two values on one edge. Use the padding shorthand, or a ` +
        `--space-* rung for one edge.`,
    ).toEqual([]);
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
