// Installs the injected gonogo host as the FIRST thing the app's module graph
// does, this module MUST be main.tsx's first import.
//
// A facade-sealed Uplink client calls the facade's `registerComponent` (and
// other host-injected surface) at MODULE LOAD, and `registerComponent` calls
// `getHost()`, which throws "the gonogo host has not been installed" if no host
// is set yet. Every client now arrives through the runtime loader, so the throw
// would land inside `import(bundleUrl)` rather than during the hoisted-import
// phase, but the ordering guarantee is the same one and is cheapest to state
// once: the host exists before ANY module body that might reach for it runs.
//
// ES `import` statements are hoisted and evaluated in source order before any
// module-body code runs, so an `installGonogoHost()` CALL later in main.tsx
// (however early) executes only after every static import has already run.
// Doing the install inside a first-imported side-effect module is the only way
// to guarantee the host is there first. This module's own imports (`./host` →
// core/data/sitrep-client) carry no facade self-registration, so running it
// first is safe.
import { installGonogoHost } from "./host";

installGonogoHost();
