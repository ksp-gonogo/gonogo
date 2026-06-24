import { migrateComponentId } from "../components/Dashboard/layoutNormalization";
import type { PeerHostService } from "../peer/PeerHostService";

/**
 * One widget a station has mirrored onto the main screen. Keyed by
 * `(peerId, widgetInstanceId)` so a single station can push several widgets
 * and each station's set can be cleanly dropped when that station disconnects.
 */
export interface PushedWidget {
  peerId: string;
  widgetInstanceId: string;
  componentId: string;
  config: Record<string, unknown>;
  width: number;
  height: number;
  /** Station name at the time the push arrived. Resolved from station-info. */
  stationName: string;
}

type Listener = (widgets: PushedWidget[]) => void;

function key(peerId: string, widgetInstanceId: string): string {
  return `${peerId}:${widgetInstanceId}`;
}

/**
 * Aggregates `widget-push` / `widget-recall` messages into a single snapshot
 * that the main screen's modal overlay subscribes to. Station names are
 * resolved via the existing `station-info` channel; pushes that land before
 * a station-info arrives fall back to "Station" until a name shows up, at
 * which point the snapshot is patched and re-emitted.
 */
export class PushHostService {
  private readonly entries = new Map<string, PushedWidget>();
  private readonly peerNames = new Map<string, string>();
  private readonly listeners = new Set<Listener>();
  private readonly unsubs: Array<() => void> = [];

  constructor(host: PeerHostService) {
    this.unsubs.push(
      host.onStationInfo((peerId, info) => {
        this.peerNames.set(peerId, info.name);
        // Patch any entries that landed before the station-info.
        let patched = false;
        for (const [k, entry] of this.entries) {
          if (entry.peerId === peerId && entry.stationName !== info.name) {
            this.entries.set(k, { ...entry, stationName: info.name });
            patched = true;
          }
        }
        if (patched) this.emit();
      }),
    );

    this.unsubs.push(
      host.onPeerDisconnect((peerId) => {
        let removed = false;
        for (const [k, entry] of this.entries) {
          if (entry.peerId === peerId) {
            this.entries.delete(k);
            removed = true;
          }
        }
        this.peerNames.delete(peerId);
        if (removed) this.emit();
      }),
    );

    this.unsubs.push(
      host.onWidgetPush((peerId, msg) => {
        this.entries.set(key(peerId, msg.widgetInstanceId), {
          peerId,
          widgetInstanceId: msg.widgetInstanceId,
          // A station on an older bundle may push a pre-rename id; migrate so
          // the host renders the widget instead of a "not registered" stub.
          componentId: migrateComponentId(msg.componentId),
          config: msg.config,
          width: msg.width,
          height: msg.height,
          stationName: this.peerNames.get(peerId) ?? "Station",
        });
        this.emit();
      }),
    );

    this.unsubs.push(
      host.onWidgetRecall((peerId, widgetInstanceId) => {
        if (this.entries.delete(key(peerId, widgetInstanceId))) this.emit();
      }),
    );
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
    this.entries.clear();
    this.peerNames.clear();
    this.listeners.clear();
  }

  snapshot(): PushedWidget[] {
    return [...this.entries.values()];
  }

  /**
   * Main-side dismiss. Doesn't notify the station — used when the operator
   * closes a pushed widget from the modal. Station-side toggle state can
   * drift, which we accept: the station sending widget-recall later is a
   * no-op; the station sending widget-push again re-inserts it.
   */
  dismiss(peerId: string, widgetInstanceId: string): void {
    if (this.entries.delete(key(peerId, widgetInstanceId))) this.emit();
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const cb of this.listeners) cb(snap);
  }
}
