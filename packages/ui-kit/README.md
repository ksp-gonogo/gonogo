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

React 18 and styled-components 6 are peer dependencies — install them if you don't have them:

```sh
npm install react@^18 styled-components@^6
```

They're peers rather than dependencies because there has to be exactly one copy of each in the
final app. styled-components keeps its `ThemeContext` in module state, so a second copy would
give your components a different context than the host's `ThemeProvider` populates, and your
`theme` would come back empty. React has the same problem one layer down. As peers, they
resolve to whatever the host already installed.

## Use it

The host app mounts the tokens and the theme once. Inside a Gonogo dashboard that's already
done for you — widgets just compose:

```tsx
import { Panel, PanelTitle, Row, Value } from "@ksp-gonogo/ui-kit";

export function Altitude({ metres }: { metres: number }) {
  return (
    <Panel>
      <PanelTitle>ALTITUDE</PanelTitle>
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

Standing the kit up yourself — Storybook, a test, a preview outside the app:

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

This is a global augmentation — it's how module augmentation works, and there's no scoped
version. Importing the kit anywhere in a project types `DefaultTheme` everywhere in it. If you
already augment `DefaultTheme` yourself, expect a conflict.

## Tokens

Values live in CSS custom properties; the theme object is a typed handle onto the same values.
Two ways in, pick whichever suits your setup:

- `@ksp-gonogo/ui-kit/tokens.css` — the raw `:root` block, and the only route to the custom
  properties themselves. Import once at your root
- `GonogoTokens` — the same block as a styled-components global sheet, for hosts that build
  global styles in JS. Render once near the root. Not auto-mounted, since injecting a
  stylesheet is a side effect

Also exported: `DefaultThemeProvider` (the default dark theme, mounted), `defaultDarkTheme`
(the theme object, if you're mounting your own `ThemeProvider`), and the contract types —
`UiKitTheme`, `ThemeColors`, `ThemeSpace`, `ThemeTypography`, `ThemeRadii`, `ThemeBorders`.

## What's in the box

**Layout** — `Box`, `Stack`, `Inline`, `Cluster`, `Grid`, `Section`, `Row`, `RowName`

**Panels and chrome** — `Panel`, `PanelTitle`, `PanelSubtitle`, `ScrollArea`, `Card`,
`WidgetHeader`, `SectionTitle`

**Readouts** — `Readout`, `BigReadout`, `ReadoutCaption`, `Value`, `Badge`, `StatusPill`,
`StatusIndicator`, `ProgressBar`, `Spinner`

**Everything else** — `ActionButton`, `EmptyState`, `Truncate`, `ScienceExperimentRow`

**Formatters** — `formatNumber`, `formatDuration`, `formatCountdown`, `formatKspDate`

Props are exported alongside each component (`BadgeProps`, `StackProps`, and so on) and the
types are the reference — they ship with the package, so your editor has them.

## One convention worth knowing

Widgets here carry close to no CSS of their own. Spacing, surfaces, borders and type all come
from the kit, which is what keeps twenty-odd widgets from twenty-odd authors reading as one
instrument panel. If you find yourself reaching for a bespoke `styled.div` to do something the
kit almost does, that's usually a gap in the kit worth
[raising](https://github.com/ksp-gonogo/gonogo/issues).

## Versioning

The kit is `0.x` and versions on its own line, independent of the Gonogo app's releases:

- **Major** — a renamed or removed token, component or prop; anything that breaks an existing
  consumer or render
- **Minor** — a new primitive, a new optional prop, a new formatter
- **Patch** — internal fixes with no API change

Token names are part of the contract, not an implementation detail — renaming one is a major.

## Licence

MIT
