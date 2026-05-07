import path from "node:path";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

export interface CameraFrame {
  cameraId: string;
  cameraName: string;
  speed: string;
  altitude: string;
  texture: Buffer;
}

// Shape of the generated CameraStream service (runtime-loaded via proto-loader).
interface CameraStreamClient extends grpc.Client {
  GetActiveCameraIds(
    req: Record<string, never>,
    cb: (err: grpc.ServiceError | null, res?: { cameras?: string[] }) => void,
  ): void;
  GetCameraTexture(
    req: { cameraId: string },
    cb: (
      err: grpc.ServiceError | null,
      res?: {
        cameraId: string;
        cameraName: string;
        speed: string;
        altitude: string;
        texture: Buffer;
      },
    ) => void,
  ): void;
  GetAverageFps(
    req: Record<string, never>,
    cb: (err: grpc.ServiceError | null, res?: { averageFps?: number }) => void,
  ): void;
}

// Resolve the proto path relative to this file so it works from both
// src/ (tsx dev) and dist/ (compiled).  The `protos/` dir sits at the
// package root; src/ and dist/ are each one level below.
const PROTO_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "protos",
  "camerastream.proto",
);

function loadService(): grpc.ServiceClientConstructor {
  const definition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const pkg = grpc.loadPackageDefinition(definition) as unknown as {
    CameraStream: { CameraStream: grpc.ServiceClientConstructor };
  };
  return pkg.CameraStream.CameraStream;
}

export class OcislyClient {
  private readonly client: CameraStreamClient;

  constructor(address: string) {
    const ServiceCtor = loadService();
    this.client = new ServiceCtor(
      address,
      grpc.credentials.createInsecure(),
    ) as unknown as CameraStreamClient;
  }

  getActiveCameraIds(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      this.client.GetActiveCameraIds({}, (err, res) => {
        if (err) return reject(err);
        resolve(res?.cameras ?? []);
      });
    });
  }

  getCameraTexture(cameraId: string): Promise<CameraFrame> {
    return new Promise((resolve, reject) => {
      this.client.GetCameraTexture({ cameraId }, (err, res) => {
        if (err) return reject(err);
        if (!res) return reject(new Error("empty GetCameraTexture response"));
        resolve({
          cameraId: res.cameraId,
          cameraName: res.cameraName,
          speed: res.speed,
          altitude: res.altitude,
          texture: res.texture,
        });
      });
    });
  }

  getAverageFps(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.client.GetAverageFps({}, (err, res) => {
        if (err) return reject(err);
        resolve(res?.averageFps ?? 0);
      });
    });
  }

  close(): void {
    this.client.close();
  }
}
