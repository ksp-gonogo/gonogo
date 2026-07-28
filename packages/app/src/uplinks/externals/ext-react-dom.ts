// FINDING (mirrors ext-react.ts's own comment): `export * from "react-dom"`
// does NOT propagate react-dom's named exports through Rollup's CJS interop,
// a runtime importer of `createPortal` (a first-party Uplink client's
// fullscreen-overlay portal) failed to link ("does not provide an export
// named 'createPortal'"), only surfacing once a runtime-loaded Uplink
// actually exercised it (`uplink-loader.spec.ts`'s loaded-outcome
// assertion). react-dom is CJS; its named surface must be re-exported
// EXPLICITLY, same as react.
// `createRoot`/`hydrateRoot` are exported at runtime but NOT in react-dom's
// root type declarations (only under `react-dom/client`): omitted here to
// keep this file typechecking; the app's own `react-dom/client` import (used
// for the app's actual root render) is unaffected, this chunk is only the
// bare `react-dom` specifier a loaded Uplink's bundle imports.
export {
  createPortal,
  default,
  findDOMNode,
  flushSync,
  hydrate,
  render,
  unmountComponentAtNode,
  unstable_batchedUpdates,
  unstable_renderSubtreeIntoContainer,
  version,
} from "react-dom";
