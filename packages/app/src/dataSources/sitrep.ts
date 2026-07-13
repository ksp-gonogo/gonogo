import type {
  ConfigField,
  DataKey,
  DataSource,
  DataSourceStatus,
} from "@ksp-gonogo/core";
import { registerDataSource } from "@ksp-gonogo/core";
import {
  bumpSitrepReconnect,
  getSitrepHostConfig,
  getSitrepTransportStatus,
  onSitrepTransportStatusChange,
  setSitrepHostConfig,
} from "../telemetry/sitrepRuntime";

/**
 * A thin `DataSource`-shaped FRONT for the Sitrep telemetry stream, so it
 * shows up in the existing "Data Sources" settings panel
 * (`@ksp-gonogo/components`'s `DataSourceStatusComponent`) with the same
 * connected/disconnected pill, Reconnect button and host/port config form
 * every other source gets — no bespoke settings UI needed.
 *
 * IMPORTANT: this is a status/config front, not a data path. Sitrep topics
 * never route through this source's `subscribe()` — `useDataValue`'s
 * carried-channels gate reads straight from the `TelemetryClient` context
 * `SitrepTelemetryProvider` mounts on the main screen. That provider owns
 * and builds the actual live `WebSocketTransport`; this class only mirrors
 * its status (via `sitrepRuntime.ts`) and lets the panel change/persist its
 * host + port.
 */
class SitrepStreamDataSource implements DataSource {
  id = "sitrep";
  name = "Telemetry stream";

  get status(): DataSourceStatus {
    return getSitrepTransportStatus();
  }

  async connect(): Promise<void> {
    // The stream is always mounted by `SitrepTelemetryProvider` — "connect"
    // here means "force the live transport to rebuild", which only makes
    // sense once it's actually given up (`WebSocketTransport` already
    // retries drops on its own). Bumping unconditionally would tear down and
    // rebuild a perfectly healthy socket every time this fires, including on
    // every MainScreen mount (it calls `connect()` on every registered
    // source once, alongside this one).
    if (getSitrepTransportStatus() === "disconnected") {
      bumpSitrepReconnect();
    }
  }

  disconnect(): void {
    // No-op. The stream's real lifecycle is owned by `SitrepTelemetryProvider`,
    // which wraps the whole main screen and tears itself down on its own
    // unmount — always in lockstep with whatever unmounts this source too.
    // There's nothing else here to release.
  }

  schema(): DataKey[] {
    return [];
  }

  subscribe(): () => void {
    // No topics are ever read through this id — see the class doc comment.
    return () => {};
  }

  onStatusChange(cb: (status: DataSourceStatus) => void): () => void {
    return onSitrepTransportStatusChange(cb);
  }

  async execute(action: string): Promise<void> {
    throw new Error(
      `SitrepStreamDataSource.execute: no actions exposed here (got "${action}").`,
    );
  }

  configSchema(): ConfigField[] {
    return [
      { key: "host", label: "Host", type: "text", placeholder: "localhost" },
      { key: "port", label: "Port", type: "number", placeholder: "8090" },
    ];
  }

  getConfig(): Record<string, unknown> {
    return getSitrepHostConfig();
  }

  configure(config: Record<string, unknown>): void {
    const current = getSitrepHostConfig();
    setSitrepHostConfig({
      host:
        typeof config.host === "string" && config.host.trim() !== ""
          ? config.host.trim()
          : current.host,
      port:
        typeof config.port === "number" && Number.isFinite(config.port)
          ? config.port
          : Number(config.port) || current.port,
    });
    // No separate reconnect nonce bump needed: `SitrepTelemetryProvider`'s
    // transport-build effect already depends on the resolved host/port, so
    // the config write above triggers the rebuild by itself.
  }

  setupInstructions(): string {
    return "The Gonogo mod's telemetry stream starts automatically once KSP is running — no scene-gating, the main menu is enough. Point Host/Port at the KSP computer if it isn't this one.";
  }
}

export const sitrepStreamSource = new SitrepStreamDataSource();
registerDataSource(sitrepStreamSource);
