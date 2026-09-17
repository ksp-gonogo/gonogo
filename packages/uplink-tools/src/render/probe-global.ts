/**
 * The `window` key the two halves of the render harness talk over.
 *
 * Its own module, importing nothing, because both halves need the VALUE and one
 * of them runs in Node: reaching for it from `../render-probe` pulls that whole
 * browser module (React, styled-components, the sdk) into the Node bundle, and
 * the sdk resolves to TypeScript source inside this workspace, so the bin died on
 * an unresolvable import before it had parsed an argument.
 *
 * Naming it once is also the point: a second spelling of the handshake is free
 * to drift green, since a driver that installs one name and waits for another
 * simply times out somewhere far from the typo.
 */
export const RENDER_PROBE_GLOBAL = "__gonogoRenderProbe";

/**
 * The attribute marking text the HARNESS drew, not the subject.
 *
 * A stand-in host is a `Panel` with a title, and that title sits inside `#root`
 * like everything else, so every check that reads the page reads it too. Both of
 * the checks that exist to catch a scene rendering nothing were satisfiable by it
 * alone: `paints: ["FUEL"]` matched "FUEL STATUS (stand-in host)" while the
 * augment drew nothing whatever, and `expectsEmpty`'s "an empty state a reader
 * can see" was the stand-in's own title. A guard a stand-in can satisfy on its
 * own is a guard that passes on the thing it exists to catch.
 *
 * Here rather than in `render-probe.tsx` for the same reason as the global above:
 * the Node half needs the value and must not import the browser module.
 */
export const PROBE_CHROME_ATTR = "data-probe-chrome";

/**
 * The contribution segments a stand-in host can actually DRAW, so a scene that
 * names one needs no `_scene.hostWidget`.
 *
 * `Panel` renders every host's `<id>.badges` aside itself, through
 * `renderWidget`'s `WidgetBadges`, so a badge lands in a stand-in exactly as it
 * lands in the real widget. Measured, and the measurement is the reason this is
 * narrower than "any slot with a dot in it": a hostless
 * `ship-map.part-meters` scene renders a completely blank frame, because
 * `part-meters` is drawn by Ship Map's OWN body and a stand-in has none. Same
 * for the other two host-invariant segments, `meters` and `filters`: a widget
 * places `<WidgetMeters>` / `<FilterList>` in its body, the framework does not.
 *
 * Here rather than beside `FRAMEWORK_AUGMENT_SEGMENTS` in `Panel.tsx` for the
 * same reason as the two above: `scenes.ts` runs in Node and reaching into the
 * kit's browser module from there pulls React and the sdk into the Node bundle.
 */
export const HOST_DRAWN_CONTRIBUTION_SEGMENTS = ["badges"] as const;
