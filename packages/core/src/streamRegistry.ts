import type { DataSourceStatus } from "./types";

/**
 * Describes a single stream offered by a StreamSource.
 *
 * `metadata` is opaque key-value data (e.g. OCISLY's cameraName / speed /
 * altitude) that the UI can show alongside the video. Scalar telemetry that
 * other widgets might care about should still flow via a regular DataSource
 * (e.g. `ocisly.camera.<id>.altitude`) — metadata here is just for the widget
 * rendering the stream itself.
 */
export interface StreamInfo {
  id: string;
  name: string;
  metadata?: Record<string, unknown>;
}

/**
 * Parallel of DataSource, for subscribing to live media (WebRTC MediaStreams)
 * instead of scalar JSON values.
 *
 * Why parallel instead of extending DataSource: MediaStreams aren't cheap to
 * fan out via peerjs data channels, and the lifecycle (track start/stop,
 * single shared instance for multiple consumers) is different enough that
 * bolting it onto DataSource would muddy the scalar path.
 */
export interface StreamSource {
  id: string;
  name: string;
  connect(): Promise<void>;
  disconnect(): void;
  status: DataSourceStatus;
  /** Snapshot of currently-advertised streams; reactive via onStreamsChange. */
  listStreams(): StreamInfo[];
  /**
   * Opens a MediaStream for `streamId`. The returned stream is shared if other
   * consumers have already subscribed; the source keeps a ref count so every
   * subscribe() requires a matching unsubscribe().
   */
  subscribe(streamId: string): Promise<MediaStream | null>;
  unsubscribe(streamId: string): void;
  onStatusChange(cb: (status: DataSourceStatus) => void): () => void;
  onStreamsChange(cb: (streams: StreamInfo[]) => void): () => void;
  /**
   * Optional: subscribe to MediaStream changes for a single camera.
   * Fires on every stream replacement — new track after a relay
   * reconnect, or `null` when the call closes and no auto-recovery
   * is in flight. Consumers that need to detect track death (e.g.
   * the CameraFeed widget after an upstream blip) listen here in
   * addition to the initial `subscribe()` promise. Sources that
   * predate this method may omit it; consumers should treat it as
   * "subscribe-once" semantics in that case.
   */
  onStreamChange?(
    streamId: string,
    cb: (stream: MediaStream | null) => void,
  ): () => void;
}

const streamSources = new Map<string, StreamSource>();

export function registerStreamSource(source: StreamSource): void {
  streamSources.set(source.id, source);
}

export function getStreamSource(id: string): StreamSource | undefined {
  return streamSources.get(id);
}

export function getStreamSources(): StreamSource[] {
  return Array.from(streamSources.values());
}

/** For use in tests only. */
export function clearStreamRegistry(): void {
  streamSources.clear();
}
