// Installs the injected gonogo host as the FIRST thing the app's module graph
// does — this module MUST be main.tsx's first import.
//
// The facade-sealed Uplink clients call the facade's `registerComponent` (and
// other host-injected surface) at MODULE LOAD. The kerbcast client's
// `CameraFeed/index.tsx` is a live example, and it is pulled into the static
// graph transitively via `MainScreen.tsx`'s `@ksp-gonogo/kerbcast-feed` import
// (a documented bundled-path domain-debt until the loader fully replaces it).
// `registerComponent` calls `getHost()`, which throws "the gonogo host has not
// been installed" if no host is set yet.
//
// ES `import` statements are hoisted and evaluated in source order before any
// module-body code runs, so an `installGonogoHost()` CALL later in main.tsx
// (however early) executes only AFTER every static import — including the one
// that self-registers a sealed client — has already thrown. Doing the install
// inside a first-imported side-effect module is the only way to guarantee the
// host exists before any client's module body runs. This module's own imports
// (`./host` → core/data/sitrep-client) carry no facade self-registration, so
// running it first is safe.
import { installGonogoHost } from "./host";

installGonogoHost();
