# @ksp-gonogo/ui-kit

The design system behind [Gonogo](https://github.com/ksp-gonogo/gonogo), a mission-control
dashboard for Kerbal Space Program. It's the same set of primitives the built-in widgets are
made of, published so that widgets and Uplinks written outside this repo look like they belong
on the same screen. Compose them and your widget picks up the host's theme, spacing and type
scale without you writing CSS for any of it.

A widget ships inside an **Uplink**, the extension unit that pairs a KSP mod with a client
bundle. This package is one of its two halves; the other is `@ksp-gonogo/sitrep-sdk`, which
carries the registration and the telemetry hooks.

## The documentation lives elsewhere

**[Gonogo Uplink developer documentation](https://ksp-gonogo.github.io/uplink-dev-docs/)** is the
reference for this package, and for everything around it:

- [the guide](https://ksp-gonogo.github.io/uplink-dev-docs/guide/), start to finish, if you have
  not written an Uplink before
- [the ui-kit reference](https://ksp-gonogo.github.io/uplink-dev-docs/reference/ui-kit/), a page
  per primitive

Every snippet on that site is transcluded from a source file that is compiled in CI, so a
signature that drifts fails the build instead of reading correctly and being wrong. This file
deliberately carries no component reference of its own: a second, unchecked copy would drift,
and it did.

What follows is only what you need before the docs are any use to you: how to install the
package, and the three environment constraints that will otherwise stop you at the first import.

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

Primitives read `theme.space` and `theme.colors`, so they need a `ThemeProvider` in scope and
will throw without one. Inside a Gonogo dashboard the host has already mounted it. Standing the
kit up yourself, for a test or a preview outside the app:

```tsx
import "@ksp-gonogo/ui-kit/tokens.css";
import { DefaultThemeProvider } from "@ksp-gonogo/ui-kit";

<DefaultThemeProvider>
  <YourWidget />
</DefaultThemeProvider>;
```

## Testing with vitest: the kit must be inlined

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

The same setting is what the kit's `/testing`, `/render-probe` and `/page-check` entry points
need, and it is the reason `expectNoA11yViolations` will otherwise appear not to exist.

**Do not read a green vitest run as proof a `@ksp-gonogo` package is loadable.** Inlining also
performs the module-extension search Node refuses to, so it hides an unloadable emit rather than
reporting it. That is a real bug this project shipped for six weeks.

## Build against `moduleResolution: "bundler"`

`deps.inline` is a bundler setting. `tsc` is not a bundler, so under
`moduleResolution: "nodenext"` the missing `exports` map bites again at the type level:

```
error TS2339: Property 'div' does not exist on type
  'typeof import(".../styled-components/dist/index")'
```

That is two lines of code with no `@ksp-gonogo` package involved:
`import styled from "styled-components"` followed by `styled.div`. Nothing in this kit can fix it
for you, and no shim in your own source fixes it cleanly either (unwrapping `.default` satisfies
`nodenext` and then breaks `bundler`, which resolves the ESM half where the default IS the factory).

So: build against `"bundler"`, which is what `@ksp-gonogo/sitrep-sdk/tsconfig.base.json` sets and
why it sets it. An Uplink whose widgets use `styled` cannot pass a `nodenext` typecheck until
styled-components ships an `exports` map, and that is a statement about styled-components rather
than about your code.

The kit's own declarations are unaffected in practice because the shipped baseline sets
`skipLibCheck: true`, which suppresses errors inside `.d.ts` files. Turning it off surfaces roughly
sixty of them, none actionable from a consumer's side.

## The theme is typed for you, everywhere

Importing the package binds the theme contract onto styled-components' `DefaultTheme`. You get
autocomplete and type errors in theme callbacks without writing your own `declare module`, so
`theme.space.bogus` is a compile error rather than `any`.

This is a global augmentation, it's how module augmentation works, and there's no scoped version.
Importing the kit anywhere in a project types `DefaultTheme` everywhere in it. If you already
augment `DefaultTheme` yourself, expect a conflict.

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
