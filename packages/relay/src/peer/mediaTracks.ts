import type { MediaStreamTrack as WrtcMediaStreamTrack } from "@roamhq/wrtc";
import wrtc from "@roamhq/wrtc";
import { decodeJpeg } from "../decode/jpegDecoder.js";

const { RTCVideoSource, rgbaToI420 } = wrtc.nonstandard;

// I420 planar size = width*height (Y) + 2 * (width/2)*(height/2) (U, V).
// Simplifies to width * height * 1.5.
function i420BufferSize(width: number, height: number): number {
  return Math.floor((width * height * 3) / 2);
}

// Ensures width/height are even — I420 requires it because U/V planes are
// half-resolution in each axis. OCISLY's default is 768x768 (even), but guard
// regardless.
function isI420Compatible(width: number, height: number): boolean {
  return width > 0 && height > 0 && width % 2 === 0 && height % 2 === 0;
}

export interface CameraVideoSource {
  track: WrtcMediaStreamTrack;
  pushJpeg(bytes: Uint8Array | Buffer): void;
  close(): void;
  /** Latest frame dimensions, after at least one successful push. */
  readonly width: number;
  readonly height: number;
  /** Count of frames successfully pushed (for metrics). */
  readonly frameCount: number;
}

/**
 * Creates a video source backed by JPEG frames pushed via pushJpeg().
 * Returns a single MediaStreamTrack that any number of peers can receive.
 */
export function createCameraVideoSource(): CameraVideoSource {
  const source = new RTCVideoSource();
  const track = source.createTrack() as unknown as WrtcMediaStreamTrack;

  let i420Buffer: Uint8Array | null = null;
  let bufferWidth = 0;
  let bufferHeight = 0;
  let frameCount = 0;
  let closed = false;

  return {
    track,
    get width() {
      return bufferWidth;
    },
    get height() {
      return bufferHeight;
    },
    get frameCount() {
      return frameCount;
    },
    pushJpeg(bytes) {
      if (closed) return;

      const decoded = decodeJpeg(bytes);

      if (!isI420Compatible(decoded.width, decoded.height)) {
        throw new Error(
          `JPEG dimensions must be even for I420 (got ${decoded.width}x${decoded.height})`,
        );
      }

      // Reallocate I420 buffer only when dimensions change.
      if (
        !i420Buffer ||
        decoded.width !== bufferWidth ||
        decoded.height !== bufferHeight
      ) {
        bufferWidth = decoded.width;
        bufferHeight = decoded.height;
        i420Buffer = new Uint8Array(i420BufferSize(bufferWidth, bufferHeight));
      }

      rgbaToI420(
        { width: decoded.width, height: decoded.height, data: decoded.rgba },
        { width: bufferWidth, height: bufferHeight, data: i420Buffer },
      );

      source.onFrame({
        width: bufferWidth,
        height: bufferHeight,
        data: i420Buffer,
      });

      frameCount += 1;
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        track.stop();
      } catch {
        /* track already stopped */
      }
      i420Buffer = null;
    },
  };
}
