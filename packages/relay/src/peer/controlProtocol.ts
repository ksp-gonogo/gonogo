import type { CameraMetadata } from "../grpc/cameraPoller.js";

// Messages sent OVER the control data channel. Plain JSON so the browser
// side can decode without extra plumbing.

export type PeerIn =
  | { type: "listCameras" }
  | { type: "subscribe"; cameraId: string }
  | { type: "unsubscribe"; cameraId: string };

export type PeerOut =
  | { type: "hello"; version: string; buildTime: string }
  | { type: "cameras"; cameras: string[] }
  | { type: "subscribed"; cameraId: string }
  | { type: "unsubscribed"; cameraId: string }
  | { type: "metadata"; metadata: CameraMetadata }
  | { type: "error"; message: string; cameraId?: string };
