import { registerDataSource } from "@ksp-gonogo/core";
import { PeerClientDataSource } from "./PeerClientDataSource";
import type { PeerClientService } from "./PeerClientService";
import type { PeerSchemaSource } from "./protocol";

/** The one source a station reads from its own link rather than from the main screen's word. */
const LOCAL_STATUS_SOURCES: ReadonlySet<string> = new Set(["sitrep"]);

/**
 * Registers a stand-in for each data source the main screen announces, so the
 * station's widgets and banners find the same ids it has. The telemetry stream
 * is left out: its status here is the station's own link to the main screen,
 * followed by the transport, and a relayed copy of the main screen's status
 * is never told again after the station reconnects.
 */
export function registerHostSources(
  sources: readonly PeerSchemaSource[],
  client: PeerClientService,
): void {
  for (const s of sources) {
    if (LOCAL_STATUS_SOURCES.has(s.id)) continue;
    const source = new PeerClientDataSource(s.id, s.name, client);
    source.setSchema(s.keys);
    registerDataSource(source);
    void source.connect();
  }
}
