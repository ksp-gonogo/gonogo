import {
  TelemetryProvider,
  useActiveTelemetryClient,
} from "@ksp-gonogo/sitrep-client";
import type { ReactNode } from "react";

/**
 * Re-provides the app's live Sitrep telemetry context inside modal content.
 *
 * `ModalProvider` (`main.tsx`) sits ABOVE `SitrepTelemetryProvider` (mounted
 * inside `MainScreen`/`StationScreen`) in the tree, and `ModalDialog` portals
 * its content as a SIBLING of `<App/>` — not a descendant of anything inside
 * it (`ModalProvider`'s own render is `{children}{modals.map(...)}`, and
 * `modals.map(...)` sits alongside `<App/>`, not nested inside it). React
 * context flows down the tree; a portal preserves whatever context surrounds
 * the CALL SITE that invoked `createPortal`, not the DOM location it renders
 * into — and that call site here is `ModalProvider` itself, above
 * `SitrepTelemetryProvider`. So `useStream`/`useTelemetry`-family hooks
 * inside modal content never see the real provider's context and silently
 * degrade to `undefined` forever — discovered via the Uplink Hub wizard's
 * dogfood e2e (`tests/playwright/uplink-hub-wizard.spec.ts`): the Data
 * Sources tab's `UplinkHealthList` (pre-existing, unrelated to that task)
 * has the exact same gap, "Waiting for uplink health report..." forever in
 * a real browser despite `system.uplinks` genuinely flowing over the wire.
 *
 * Reuses the SAME live `TelemetryClient` (read reactively via
 * `useActiveTelemetryClient`, the same "whichever `TelemetryProvider` most
 * recently mounted" source `SettingsFab.tsx`'s `handleClick` captures once
 * for `SettingsProvider`/`ScreenProvider`/`SerialDeviceProvider`) rather than
 * opening a second WebSocket: `TelemetryProvider` auto-builds its own
 * `TimelineStore` when given a `client` with no `store` prop, and
 * `TelemetryClient.attachStore` supports multiple attached stores — the new
 * store mirrors the exact same wire frames the main dashboard's store does,
 * no extra network connection, no duplicate subscription.
 *
 * Deliberately REACTIVE, not a one-shot read at render: a modal can open
 * before the app's own `TelemetryProvider` has mounted (first-run auto-open
 * of the Uplink Hub wizard is the confirmed real-world case — it can fire
 * before the Sitrep client has connected). A one-shot `getActiveTelemetryClient()`
 * call would capture `undefined` at that moment and never recover, leaving
 * the modal's telemetry reads (e.g. the wizard's `useUplinkGap`) hung
 * forever even after the client connects a moment later.
 * `useActiveTelemetryClient` re-renders this component the instant a
 * provider mounts, so the modal picks up the client as soon as it exists.
 *
 * Renders `children` untouched if no `TelemetryProvider` is mounted anywhere
 * yet (disconnected / pre-boot / station screen with no stream) — the same
 * graceful-degrade contract every `useStream`-family hook already has, so
 * wrapping unconditionally here never turns a legitimately-disconnected
 * state into a crash.
 */
export function ModalTelemetryBridge({
  children,
}: Readonly<{ children: ReactNode }>) {
  const client = useActiveTelemetryClient();
  if (!client) return <>{children}</>;
  return <TelemetryProvider client={client}>{children}</TelemetryProvider>;
}
