import { registerSetting } from "@ksp-gonogo/sitrep-sdk";
import type { KerbcastDataSource } from "../KerbcastDataSource";

/*
 * kerbcast's declarative settings — two rows under one "Kerbcast" category in
 * the app's General settings surface. This REPLACES the old bespoke
 * `KerbcastSettings` tab (registerSettingsTab): declarative is the preferred
 * path (see @ksp-gonogo/core's settings/registry.ts), so kerbcast carries ZERO
 * bespoke settings UI now.
 *
 * Side-effect module: importing it runs both registrations once, the same
 * lifecycle as the package's other `registerX` module-load calls.
 */

registerSetting({
  // (1) The embedded-facecam kill-switch — a pure client-pref preference
  // (no mod round-trip). Gates ambient crew facecams (the crew-manifest.avatar
  // augment); the dedicated Facecam Wall widget is exempt (placing it is the
  // opt-in). Default ON to match the always-live UX.
  id: "kerbcast.embeddedFacecams",
  type: "boolean",
  defaultValue: true,
  category: "Kerbcast",
  label: "Embedded facecams",
  description:
    "Show live crew faces in CrewManifest avatars. Off means no ambient facecam streams — the dedicated Facecam Wall widget still works.",
  screens: ["main"],
});

registerSetting({
  // (2) The throttle — a source-backed setting bound to the existing
  // KerbcastDataSource methods (mod round-trip, persists save-side). The
  // methods are unchanged; only the rendering moves to the registry. Resolved
  // via the uplink-handle registry (`registerUplinkHandle("kerbcast", …)`).
  id: "kerbcast.throttleMainRender",
  backing: "source-backed",
  type: "boolean",
  sourceId: "kerbcast",
  read: (s) => (s as KerbcastDataSource).getThrottleMainScreen(),
  write: (s, v) => {
    void (s as KerbcastDataSource).setThrottleMainScreen(v);
  },
  subscribe: (s, cb) => (s as KerbcastDataSource).onThrottleChange(cb),
  category: "Kerbcast",
  label: "Throttle KSP main render",
  description:
    "Disables the main KSP flight cameras to free GPU headroom for kerbcast streams. Persists across saves.",
  screens: ["main"],
});
