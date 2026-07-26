// Non-widget kerbcast runtime infra — split out of `index.ts` so importing it
// does NOT evaluate `./CameraFeed`.
//
// MainScreen needs `kerbcastSource`/`KERBCAST_EVENTS_TOPIC`/
// `useKerbcastMainConnect` regardless of whether the CameraFeed WIDGET itself
// is statically bundled or loaded at runtime via the Uplink loader
// (`app/src/uplinks/loader.ts`). Before this split it imported those names
// from the package root (`@ksp-gonogo/gonogo-kerbcast-uplink`), which forced
// evaluation of the WHOLE `index.ts` module — ES module evaluation always
// runs a module's full top-level code once, regardless of which named export
// the importer actually uses — including `import "./CameraFeed";`, which
// self-registers the "camera-feed" widget via `registerComponent`.
// `@ksp-gonogo/core` makes that call THROW on a duplicate id (by design —
// component ids must be unique), so under the runtime-loader flag the
// loader's OWN dynamically-imported `kerbcast.client.js` bundle would have
// always collided with the copy MainScreen had already registered at
// module-load time, and always quarantined, mirroring kos's identical
// `runtime.ts` split (see that file's doc comment for the full mechanism —
// caught by `uplink-loader.spec.ts`'s Settings "Loaded clients" panel
// assertion).
//
// `registerUplinkHandle("kerbcast", kerbcastSource)` (in `KerbcastDataSource`)
// and `registerBarePrimitiveTopic("kerbcast.available")` (in `topics`) are
// Map-based and idempotent — re-running them from both this file AND the
// loaded bundle is harmless, unlike `registerComponent`.
//
// `index.ts` re-exports this file, so nothing downstream of the package root
// loses access to these names — only MainScreen needs to import from
// `@ksp-gonogo/gonogo-kerbcast-uplink/runtime` specifically instead of the package
// root. DockingCameraAugment, the widget-picker settings category, and
// CameraFeed itself stay package-root-only: they're registered either by
// `main.tsx`'s bundled-fallback full-package import (flag off) or by the
// loader's own full-package bundle (flag on) — neither of which this split
// affects.

import "./topics"; // registerBarePrimitiveTopic("kerbcast.available") — idempotent
import "./KerbcastDataSource"; // kerbcastSource singleton + registerUplinkHandle("kerbcast", ...) — idempotent

export { useKerbcastMainConnect } from "./hooks/useKerbcastMainConnect";
export * from "./KerbcastDataSource";
export {
  KERBCAST_EVENTS_TOPIC,
  KerbcastEventProducer,
} from "./KerbcastEventProducer";
