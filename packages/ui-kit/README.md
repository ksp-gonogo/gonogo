# @ksp-gonogo/ui-kit

The design system behind [Gonogo](https://github.com/ksp-gonogo/gonogo), a mission-control
dashboard for Kerbal Space Program. It's the same set of primitives the built-in widgets are
made of, published so that widgets and Uplinks written outside this repo look like they belong
on the same screen.

If you're building a Gonogo widget, start here. Compose these primitives and your widget picks
up the host's theme, spacing and type scale without you writing CSS for any of it.

## Install

```sh
npm install @ksp-gonogo/ui-kit
```

React 18 and styled-components 6 are peer dependencies; install them if you don't have them:

```sh
npm install react@^18 styled-components@^6
```

They're peers rather than dependencies because there has to be exactly one copy of each in the
final app. styled-components keeps its `ThemeContext` in module state, so a second copy would
give your components a different context than the host's `ThemeProvider` populates, and your
`theme` would come back empty. React has the same problem one layer down. As peers, they
resolve to whatever the host already installed.

### Testing with vitest: the kit must be inlined

Add this to your `vitest.config.ts`, or every test file that touches the kit dies on import
before a single assertion runs:

```ts
export default defineConfig({
  test: {
    server: { deps: { inline: [/@ksp-gonogo/] } },
  },
});
```

Vitest hands `node_modules` dependencies to Node's ESM loader rather than transforming them, and
`styled-components@6` publishes no `exports` map, only `main` (CommonJS) and `module` (ESM).
Node therefore loads the CommonJS half, and its interop makes the default export the module
namespace object rather than the `styled` factory. The kit evaluates `styled.span` at module
scope, so you get:

```
TypeError: styled.span is not a function
```

before any of your code runs. Inlining makes Vite process the kit itself, which honours `module`
and resolves the factory. This is not specific to this kit, it is what any styled-components
library needs from vitest, and it is why you will not see the problem in a monorepo where the kit
is a workspace symlink: Vite never pre-bundles a linked dependency.

The same setting is what `@ksp-gonogo/ui-kit/testing`, `/render-probe` and `/page-check` need,
and it is the reason `expectNoA11yViolations` will otherwise appear not to exist.

**Do not read a green vitest run as proof a `@ksp-gonogo` package is loadable.** Inlining also
performs the module-extension search Node refuses to, so it hides an unloadable emit rather than
reporting it. That is a real bug this project shipped for six weeks.

## Use it

The host app mounts the tokens and the theme once. Inside a Gonogo dashboard that's already
done for you: widgets just compose:

```tsx
import { Panel, Row, Value } from "@ksp-gonogo/ui-kit";

export function Altitude({ metres }: { metres: number }) {
  return (
    <Panel panelTitle="ALTITUDE">
      <ul>
        <Row>
          <Row.Name>ASL</Row.Name>
          <Value>{metres.toFixed(0)} m</Value>
        </Row>
      </ul>
    </Panel>
  );
}
```

`Panel` gives you the heading and a padded, scrolling body. Pass `panelTitle`
rather than rendering a title yourself; the panel owns its own presentation so
a change to how titles look is one edit here, not one per widget.

If you need a different arrangement, `Panel` is nothing but a composition of
parts you can reach individually:

```tsx
<Panel.Context>
  <Panel.Container>
    <Panel.Glow>
      <Panel.Title>ALTITUDE</Panel.Title>
      <Panel.Body>{/* … */}</Panel.Body>
    </Panel.Glow>
  </Panel.Container>
</Panel.Context>
```

`Panel.Body` owns the inset and the scrolling; `Panel.Glow` owns the overflow
glow and finds the scroller through `Panel.Context`, so it does not care
whether it wraps the body or sits beside it. `fitToSize` on either `Panel` or
`Panel.Body` is for content sized to the tile that must never scroll.

### Heavier chrome

Four props cover the widgets whose chrome is more than a title row:

- **`panelAside`** is the small slot beside the title: a chip, a badge, one
  select. Reach for it first.
- **`panelToolbar`** is a full-width row of controls on its own line below the
  title, pinned outside the scrolling body (a map's layer pickers, a graph's
  series toggles). Use it when the controls are a row in their own right;
  crowding them into the aside squeezes the title at realistic tile widths, and
  putting them in the body scrolls them away from what they steer.
- **`floatingHeader`** floats the header over the content and lets the body
  bleed to the panel chrome without scrolling. Only for a widget that is
  WHOLLY a drawing (an orbit view, a globe): the title keeps a panel-coloured
  backing so it stays legible, and the drawing gets the whole tile.
- **`panelSidebar`** is a second region beside or below the body, with its own
  scroller: an almanac for a diagram, a legend for a plot, a detail pane for
  the selected row. It is for content whose scrolling must not move what it
  annotates; content that should scroll *with* the body is just body content.

```tsx
<Panel panelTitle="SYSTEM" panelSidebar={<Almanac />} sidebarSize="14rem">
  <FramedDisplay>
    <SystemDiagram />
  </FramedDisplay>
</Panel>
```

`sidebarSide` is `"auto" | "start" | "end"` and takes logical edges rather than
left/right/top/bottom, so one prop covers both axes and `end` is the right edge
in LTR and the left edge in RTL for free. `end` is the default because a
sidebar is secondary content and should not precede what it annotates in
reading order. Whichever edge you pick, the sidebar is always written after the
body in the DOM and moves visually only, so reading and tab order never depend
on the arrangement.

`auto` lets the panel pick the axis from the tile's measured shape, not from a
pixel breakpoint: wider than tall puts the sidebar beside the body, taller than
wide puts it underneath. `sidebarSize` sizes that track, defaulting to `14rem`
beside and `40%` underneath, because a column next to a diagram wants an
absolute width while a strip under one is competing for the tile's height.

Leaving `panelSidebar` unset changes nothing: no grid, no extra box, and the
body is the element it has always been.

All four are reachable for hand-composition too, as `Panel.Toolbar`,
`Panel.Split` + `Panel.Sidebar`, and the `overlay` / `bleed` props on
`Panel.Header` and `Panel.Body`.

Visual content, an SVG diagram or a canvas, goes in `FramedDisplay` rather than
fighting the body inset: the frame gives it a defined edge, and in a widget
with a sidebar it does the dividing too.

Reach for the frame first, and for `floatingHeader` only when the body holds
nothing but the drawing. Most widgets are mixed, a diagram beside readouts, and
cancelling the body inset for the diagram unpads the readouts with it. There is
deliberately no standalone "unpad the body" prop for that reason; the float is
attached to it because a widget with readouts would never ask for a title
floating over them.


Standing the kit up yourself: Storybook, a test, a preview outside the app:

```tsx
import "@ksp-gonogo/ui-kit/tokens.css";
import { DefaultThemeProvider } from "@ksp-gonogo/ui-kit";

<DefaultThemeProvider>
  <YourWidget />
</DefaultThemeProvider>;
```

Primitives read `theme.space` and `theme.colors`, so they need a `ThemeProvider` in scope and
will throw without one.

## The theme is typed for you

Importing the package binds the theme contract onto styled-components' `DefaultTheme`. You get
autocomplete and type errors in theme callbacks without writing your own `declare module`:

```tsx
const Label = styled.span`
  padding: ${({ theme }) => theme.space.md};  // typed
  color: ${({ theme }) => theme.colors.text.muted};
`;
```

`theme.space.bogus` is a compile error, not `any`.

This is a global augmentation, it's how module augmentation works, and there's no scoped
version. Importing the kit anywhere in a project types `DefaultTheme` everywhere in it. If you
already augment `DefaultTheme` yourself, expect a conflict.

## Tokens

Values live in CSS custom properties; the theme object is a typed handle onto the same values.

- `@ksp-gonogo/ui-kit/tokens.css`: the raw `:root` block, and the route to the custom
  properties themselves. Import once at your root

Also exported: `DefaultThemeProvider` (the default dark theme, mounted), `defaultDarkTheme`
(the theme object, if you're mounting your own `ThemeProvider`), and the contract types,
`UiKitTheme`, `ThemeColors`, `ThemeSpace`, `ThemeTypography`, `ThemeRadii`, `ThemeBorders`.

## What's in the box

**Layout**: `Box`, `Stack`, `Inline`, `Cluster`, `Grid`, `Section`, `Row`, `RowName`

**Panels and chrome**: `Panel` (see below), `ScrollArea`, `Card`,
`WidgetHeader`, `SectionTitle`

**Readouts**: `Readout`, `BigReadout`, `ReadoutCaption`, `Value`, `Badge`, `StatusPill`,
`StatusIndicator`, `ProgressBar`, `Spinner`

**Everything else**: `ActionButton`, `EmptyState`, `Truncate`, `ScienceExperimentRow`

**Formatters**: `formatNumber`, `formatDuration`, `formatCountdown`, `formatKspDate`

Props are exported alongside each component (`BadgeProps`, `StackProps`, and so on) and the
types are the reference, they ship with the package, so your editor has them.

## One convention worth knowing

Widgets here carry close to no CSS of their own. Spacing, surfaces, borders and type all come
from the kit, which is what keeps twenty-odd widgets from twenty-odd authors reading as one
instrument panel. If you find yourself reaching for a bespoke `styled.div` to do something the
kit almost does, that's usually a gap in the kit worth
[raising](https://github.com/ksp-gonogo/gonogo/issues).

## Versioning

The kit is `0.x` and versions on its own line, independent of the Gonogo app's releases:

- **Major**: a renamed or removed token, component or prop; anything that breaks an existing
  consumer or render
- **Minor**: a new primitive, a new optional prop, a new formatter
- **Patch**: internal fixes with no API change

Token names are part of the contract, not an implementation detail, renaming one is a major.

## Licence

MIT
