# Uplink external-entry chunks

Each `ext-*.ts` here is a standalone Vite build entry (wired in `vite.config.ts`
via `UPLINK_EXTERNALS`) that re-exports one shared package the app already owns.
Because a single Rollup build keeps every shared module in exactly ONE chunk,
these entries re-export the app's **singleton** instances (the `@ksp-gonogo/core`
registry `Map`s, React's dispatcher, the styled-components stylesheet) rather
than a second copy.

A runtime-loaded Uplink client bundle is built with these specifiers marked
`external`; its bare `import { registerComponent } from "@ksp-gonogo/core"`
statements resolve — through the `<script type="importmap">` baked into
`index.html` at build time — to these emitted chunks. So a loaded widget's
module-load `registerComponent(...)` writes into the SAME registry the dashboard
reads. This is the load-bearing singleton-preservation mechanism (design
`docs/superpowers/specs/2026-07-17-uplink-hub-and-loader-design.md` §2.2).

Two findings from the R1 spike are baked into the file shapes here:

1. **`export *` gets tree-shaken.** Rollup drops re-exports no in-build consumer
   imports, so a singleton the app never imports directly (e.g. core's
   `AugmentSlot`) would vanish from `ext-core` and a runtime Uplink that needs it
   fails to link. Fixed by `preserveEntrySignatures: "strict"` in `vite.config.ts`.
2. **CJS-interop named exports don't survive `export *`.** `export * from "react"`
   did NOT expose `useEffect` (react is CJS); the named surface must be
   re-exported EXPLICITLY — see `ext-react.ts` / `ext-react-jsx-runtime.ts`.
