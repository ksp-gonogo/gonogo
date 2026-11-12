# @ksp-gonogo/ui-kit

The design system behind [Gonogo](https://github.com/ksp-gonogo/gonogo), a mission control app for Kerbal Space Program. It is the set of components the app's own widgets are drawn with, published so that the widgets of an Uplink, the extension that connects a KSP mod to the app, look like they belong on the same screen. Compose them and a widget takes the host's theme, spacing and type scale without any CSS of its own.

**The [Uplink developer docs](https://ksp-gonogo.github.io/uplink-dev-docs/) are the reference for this package.** The [guide](https://ksp-gonogo.github.io/uplink-dev-docs/guide/) takes you from an empty directory to an Uplink a player can install, and the [ui-kit reference](https://ksp-gonogo.github.io/uplink-dev-docs/reference/ui-kit/) has a page for each component. This page has no component reference, and holds what you need before the docs are any use: install, and what the environment must provide.

## Install

Until the first release, `latest` is a placeholder, so install the release candidate with `@rc`.

```sh
npm install @ksp-gonogo/ui-kit@rc
```

An Uplink installs this package with `@ksp-gonogo/sitrep-sdk` and `@ksp-gonogo/uplink-tools` under the same tag, at one version. The kit names the sdk of its release as an exact peer, so one beside another release fails to resolve. `uplink-tools new` writes that set for you, and [Building against a release candidate](https://ksp-gonogo.github.io/uplink-dev-docs/guide/release-candidate) covers adding it by hand.

React 18 and styled-components 6 are peer dependencies:

```sh
npm install react@^18 styled-components@^6
```

They are peers because the app must hold exactly one copy of each: styled-components keeps its `ThemeContext` in module state, so a second copy would not see the host's `ThemeProvider`. React 19 is not supported.

## Entry points

| Entry | What it is |
|---|---|
| `@ksp-gonogo/ui-kit` | the components, hooks and the theme contract |
| `@ksp-gonogo/ui-kit/tokens.css` | the colour, spacing and type variables the components read |
| `@ksp-gonogo/ui-kit/testing` | helpers for a widget's tests, such as `expectNoA11yViolations` and `renderWidget` |
| `@ksp-gonogo/ui-kit/grid` | the dashboard grid's units |
| `@ksp-gonogo/ui-kit/guards` | checks an Uplink runs against its own source from a test file; it reads the filesystem, so it is Node only |

## Theme and tokens

An Uplink loaded by the app already has the tokens. Outside the app, import `@ksp-gonogo/ui-kit/tokens.css` once, or every colour and size is unset. Components read `theme.space` and `theme.colors` and need a `ThemeProvider` in scope. Inside the Gonogo dashboard the host has mounted one. For a test or a preview outside the app:

```tsx
import "@ksp-gonogo/ui-kit/tokens.css";
import { DefaultThemeProvider } from "@ksp-gonogo/ui-kit";

<DefaultThemeProvider>
  <YourWidget />
</DefaultThemeProvider>;
```

Importing the package also types styled-components' `DefaultTheme` with the theme contract, so `theme.space.bogus` is a compile error. That is a global module augmentation, so a project that augments `DefaultTheme` itself will conflict with it.

## Testing with vitest

Inline the kit in `vitest.config.ts`, or every test file that touches it fails on import:

```ts
export default defineConfig({
  test: {
    server: { deps: { inline: [/@ksp-gonogo/] } },
  },
});
```

The scaffold's `client/vitest.config.ts` already has it. Without it the first import fails with:

```
TypeError: styled.span is not a function
```

styled-components 6 publishes no `exports` map, so vitest hands it to Node's ESM loader, which takes the CommonJS build, whose default export is the module namespace and not the `styled` factory. Inlining makes Vite process the kit itself, which uses the ESM build. The kit's `/testing` entry needs the same setting.

A green vitest run does not show that a `@ksp-gonogo` package loads in Node, because inlining also does the file-extension search Node refuses to. `uplink-tools check --only loadable` imports each entry point in a bare `node` to test that.

## Versioning

The kit carries the Gonogo release version, the same one as `@ksp-gonogo/sitrep-sdk`, `@ksp-gonogo/uplink-tools` and the app it shipped with. What its surface promises is held by the extension API version, which the app checks before it loads an Uplink, and not by the package version. Token names are part of that surface: renaming one is a breaking change.

Widgets carry almost no CSS of their own, which is what lets widgets from many authors read as one instrument panel. A gap you meet in the kit is worth [raising as an issue](https://github.com/ksp-gonogo/gonogo/issues).

## Licence

MIT
