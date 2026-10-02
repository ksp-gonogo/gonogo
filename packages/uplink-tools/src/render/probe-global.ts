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
 *
 * @category Rendering scenes
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
 * The attribute on the box-less wrapper a highlighted augment renders inside,
 * which the probe's stylesheet outlines the children of. The wrapper is the
 * harness's own element, so the held comparison leaves it out of the subject's
 * render.
 */
export const SUPPLIED_ATTR = "data-uplink-supplied";

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

/**
 * The tag the probe appends to an element drawn as held (`data-held`)
 * that {@link announcesHeld} says is silent: a mark a reader can see and a
 * screen reader is told nothing about.
 */
export const UNANNOUNCED_MARK = "(held, unannounced)";

/**
 * Whether an element drawn held says so to a screen reader: through a
 * `data-unit-currency` caption inside it, the way `Unit` does, through its
 * own accessible name, which the kit's instruments end with the caption and
 * stamp `data-currency-in-name`, or through the caption `ModelledAlongside`
 * draws beside the marked figure it wraps.
 */
export function announcesHeld(el: Element): boolean {
  return (
    el.hasAttribute("data-currency-in-name") ||
    el.querySelector("[data-unit-currency]") !== null ||
    el
      .closest("[data-modelled-alongside]")
      ?.querySelector(":scope > [data-unit-currency]") != null
  );
}

/**
 * The subject's render as a list of elements, for the held comparison.
 *
 * <p>Finer than the probe's size-outline signature on purpose. A widget that
 * says a figure is held often changes nothing a size outline can see: a colour, a
 * `data-held` attribute, a dimmed class. So every attribute is kept,
 * `class` included, which is stable here because one page renders every scene
 * and an identical style always hashes to the identical class.</p>
 *
 * <p>React ids are folded to one token rather than renumbered: the comparison
 * that reads these lines subtracts one render from another, and an id counter
 * that shifted because a guest mounted before an element would otherwise make
 * the host's own element look changed.</p>
 *
 * <p>A widget that strips the colons from a `useId`, as an SVG id and its
 * `url(#...)` need, leaves a bare `r` and counter. That form is folded too, but
 * only where an id is: as an `id`, an id reference, or inside `url(#...)`.</p>
 *
 * <p>A class token a library numbers per instance is folded when it is on
 * {@link INSTANCE_COUNTER_CLASSES}, and compared as written when it is not.</p>
 *
 * <p>A `data-held` element that does not {@link announcesHeld} is tagged
 * {@link UNANNOUNCED_MARK}: the dot is drawn, and nothing tells a screen reader
 * the figure is held.</p>
 */
export function describeElements(host: HTMLElement): string[] {
  const lines: string[] = [];
  for (const el of Array.from(host.querySelectorAll("*"))) {
    if (el.closest(`[${PROBE_CHROME_ATTR}]`)) continue;
    if (el.hasAttribute(SUPPLIED_ATTR)) continue;
    if (el.tagName === "STYLE" || el.tagName === "SCRIPT") continue;
    const attributes = Array.from(el.attributes)
      .map((a) => `${a.name}="${foldAttribute(a.name, a.value)}"`)
      .sort();
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    let line = `<${el.tagName.toLowerCase()} ${attributes.join(" ")}> ${own}`;
    if (el.hasAttribute("data-held") && !announcesHeld(el)) {
      line += ` ${UNANNOUNCED_MARK}`;
    }
    lines.push(line);
  }
  return lines;
}

/** A `useId` as React 18 and 19 mint it, colons or guillemets included. */
const REACT_ID = /:r[0-9a-z]+:|«r[0-9a-z]+»/g;

/**
 * A `useId` with its colons stripped: `r` and a base-32 counter, standing as a
 * whole hyphen- or underscore-separated segment. It is also an ordinary word
 * (`r1`, `rad`), which is why it is only folded where an id is.
 */
const BARE_REACT_ID = /(^|[-_])r[0-9a-v]+(?=$|[-_])/g;

/** Attributes whose whole value is an id or a list of ids. */
const ID_ATTRIBUTES = new Set([
  "id",
  "for",
  "form",
  "list",
  "headers",
  "aria-activedescendant",
  "aria-controls",
  "aria-describedby",
  "aria-details",
  "aria-errormessage",
  "aria-flowto",
  "aria-labelledby",
  "aria-owns",
]);

function foldBareId(id: string): string {
  return id.replace(BARE_REACT_ID, "$1:r:");
}

function foldReactIds(name: string, value: string): string {
  const folded = value
    .replace(REACT_ID, ":r:")
    .replace(/url\(#([^)]*)\)/g, (_, id: string) => `url(#${foldBareId(id)})`);
  const fragment =
    (name === "href" || name === "xlink:href") && folded.startsWith("#");
  if (!ID_ATTRIBUTES.has(name) && !fragment) return folded;
  return folded.replace(/[^\s#]+/g, foldBareId);
}

/**
 * Class tokens a third-party library numbers from a module-level counter, so
 * two mounts of one state carry different ones. Each names its library. A
 * numbered token not listed here is a difference like any other.
 */
const INSTANCE_COUNTER_CLASSES: readonly { library: string; token: RegExp }[] =
  [
    {
      library: "xterm.js DomRenderer",
      token: /^(xterm-dom-renderer-owner-)\d+$/,
    },
  ];

function foldAttribute(name: string, value: string): string {
  if (name !== "class") return foldReactIds(name, value);
  const tokens = value.split(/\s+/).map((token) => {
    const known = INSTANCE_COUNTER_CLASSES.find((c) => c.token.test(token));
    return known ? token.replace(known.token, "$1<n>") : token;
  });
  return foldReactIds(name, tokens.join(" "));
}
