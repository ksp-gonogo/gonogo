import {
  type CameraVideoSource,
  createCameraVideoSource,
} from "../peer/mediaTracks.js";
import type { CameraFrame, OcislyClient } from "./OcislyClient.js";

export interface CameraMetadata {
  cameraId: string;
  cameraName: string;
  speed: string;
  altitude: string;
}

export interface CameraPollerOptions {
  client: OcislyClient;
  /** Target poll rate per camera. Default: 30 Hz. */
  framesPerSecond?: number;
  /** Called each time a frame successfully arrives (metrics + metadata fanout). */
  onFrame?: (meta: CameraMetadata) => void;
  /** Logger for errors; defaults to console. */
  logger?: { error: (msg: string, err?: unknown) => void };
}

interface PollerEntry {
  subscribers: number;
  source: CameraVideoSource;
  timer: NodeJS.Timeout | null;
  latestMetadata: CameraMetadata | null;
  inFlight: boolean;
  pollsTotal: number;
  pollsWithTexture: number;
  pollsWithoutTexture: number;
  pollErrors: number;
  lastTextureBytes: number;
}

export interface CameraStats {
  cameraId: string;
  subscribers: number;
  pollsTotal: number;
  pollsWithTexture: number;
  pollsWithoutTexture: number;
  pollErrors: number;
  lastTextureBytes: number;
  framesPushed: number;
  width: number;
  height: number;
}

/**
 * Tracks one video source per camera id, started on demand when a subscriber
 * attaches and stopped when the last subscriber detaches. The source + its
 * MediaStreamTrack is shared across all subscribers of that camera.
 */
export class CameraPoller {
  private entries = new Map<string, PollerEntry>();
  private readonly client: OcislyClient;
  private readonly intervalMs: number;
  private readonly onFrame?: (meta: CameraMetadata) => void;
  private readonly logger: { error: (msg: string, err?: unknown) => void };

  constructor(opts: CameraPollerOptions) {
    this.client = opts.client;
    this.intervalMs = Math.max(
      1,
      Math.round(1000 / (opts.framesPerSecond ?? 30)),
    );
    this.onFrame = opts.onFrame;
    this.logger = opts.logger ?? {
      error: (msg, err) => console.error(msg, err),
    };
  }

  /**
   * Returns the shared source for `cameraId`, creating + starting the poll
   * loop on first subscription. Call `release(cameraId)` when done.
   */
  subscribe(cameraId: string): CameraVideoSource {
    let entry = this.entries.get(cameraId);
    if (!entry) {
      entry = {
        subscribers: 0,
        source: createCameraVideoSource(),
        timer: null,
        latestMetadata: null,
        inFlight: false,
        pollsTotal: 0,
        pollsWithTexture: 0,
        pollsWithoutTexture: 0,
        pollErrors: 0,
        lastTextureBytes: 0,
      };
      this.entries.set(cameraId, entry);
      this.startLoop(cameraId, entry);
    }
    entry.subscribers += 1;
    return entry.source;
  }

  release(cameraId: string): void {
    const entry = this.entries.get(cameraId);
    if (!entry) return;
    entry.subscribers -= 1;
    if (entry.subscribers <= 0) {
      this.stopLoop(entry);
      entry.source.close();
      this.entries.delete(cameraId);
    }
  }

  latestMetadata(cameraId: string): CameraMetadata | null {
    return this.entries.get(cameraId)?.latestMetadata ?? null;
  }

  stats(): CameraStats[] {
    const out: CameraStats[] = [];
    for (const [id, entry] of this.entries) {
      out.push({
        cameraId: id,
        subscribers: entry.subscribers,
        pollsTotal: entry.pollsTotal,
        pollsWithTexture: entry.pollsWithTexture,
        pollsWithoutTexture: entry.pollsWithoutTexture,
        pollErrors: entry.pollErrors,
        lastTextureBytes: entry.lastTextureBytes,
        framesPushed: entry.source.frameCount,
        width: entry.source.width,
        height: entry.source.height,
      });
    }
    return out;
  }

  shutdown(): void {
    for (const [id, entry] of this.entries) {
      this.stopLoop(entry);
      entry.source.close();
      this.entries.delete(id);
    }
  }

  private startLoop(cameraId: string, entry: PollerEntry): void {
    const tick = async () => {
      if (entry.inFlight) return; // skip if the previous poll hasn't resolved
      entry.inFlight = true;
      try {
        const frame: CameraFrame = await this.client.getCameraTexture(cameraId);
        if (!entry.timer) return; // released while we were awaiting
        entry.pollsTotal += 1;
        if (frame.texture && frame.texture.length > 0) {
          entry.pollsWithTexture += 1;
          entry.lastTextureBytes = frame.texture.length;
          try {
            entry.source.pushJpeg(frame.texture);
          } catch (err) {
            this.logger.error(
              `[cameraPoller] pushJpeg failed for ${cameraId}`,
              err,
            );
          }
        } else {
          entry.pollsWithoutTexture += 1;
        }
        const meta: CameraMetadata = {
          cameraId: frame.cameraId || cameraId,
          cameraName: frame.cameraName,
          speed: frame.speed,
          altitude: frame.altitude,
        };
        entry.latestMetadata = meta;
        this.onFrame?.(meta);
      } catch (err) {
        entry.pollErrors += 1;
        this.logger.error(
          `[cameraPoller] GetCameraTexture failed for ${cameraId}`,
          err,
        );
      } finally {
        entry.inFlight = false;
      }
    };

    entry.timer = setInterval(tick, this.intervalMs);
    // Fire one immediately so the first frame doesn't wait a full interval.
    void tick();
  }

  private stopLoop(entry: PollerEntry): void {
    if (entry.timer) {
      clearInterval(entry.timer);
      entry.timer = null;
    }
  }
}
