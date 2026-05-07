import path from "node:path";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OcislyClient } from "../grpc/OcislyClient.js";

// Spin up a real in-process gRPC server that implements the CameraStream
// service with canned responses.  This is the same "mock as little as
// possible" boundary testing used elsewhere in the repo.

const PROTO_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "protos",
  "camerastream.proto",
);

interface TestServerHandles {
  server: grpc.Server;
  address: string;
  state: {
    cameras: string[];
    textureByCamera: Map<
      string,
      {
        cameraId: string;
        cameraName: string;
        speed: string;
        altitude: string;
        texture: Buffer;
      }
    >;
    averageFps: number;
  };
}

async function startMockServer(): Promise<TestServerHandles> {
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
  const service = pkg.CameraStream.CameraStream.service;

  const state: TestServerHandles["state"] = {
    cameras: [],
    textureByCamera: new Map(),
    averageFps: 0,
  };

  const server = new grpc.Server();
  server.addService(service, {
    GetActiveCameraIds: (
      _call: grpc.ServerUnaryCall<unknown, unknown>,
      cb: grpc.sendUnaryData<unknown>,
    ) => {
      cb(null, { cameras: state.cameras });
    },
    GetCameraTexture: (
      call: grpc.ServerUnaryCall<{ cameraId: string }, unknown>,
      cb: grpc.sendUnaryData<unknown>,
    ) => {
      const frame = state.textureByCamera.get(call.request.cameraId);
      if (!frame) {
        cb({
          code: grpc.status.NOT_FOUND,
          message: "unknown camera",
        } as grpc.ServiceError);
        return;
      }
      cb(null, frame);
    },
    GetAverageFps: (
      _call: grpc.ServerUnaryCall<unknown, unknown>,
      cb: grpc.sendUnaryData<unknown>,
    ) => {
      cb(null, { averageFps: state.averageFps });
    },
    SendCameraStream: (
      _call: grpc.ServerUnaryCall<unknown, unknown>,
      cb: grpc.sendUnaryData<unknown>,
    ) => {
      cb(null, {});
    },
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync(
      "127.0.0.1:0",
      grpc.ServerCredentials.createInsecure(),
      (err, p) => {
        if (err) reject(err);
        else resolve(p);
      },
    );
  });

  return { server, address: `127.0.0.1:${port}`, state };
}

describe("OcislyClient", () => {
  let handles: TestServerHandles;
  let client: OcislyClient;

  beforeEach(async () => {
    handles = await startMockServer();
    client = new OcislyClient(handles.address);
  });

  afterEach(async () => {
    client.close();
    await new Promise<void>((resolve) =>
      handles.server.tryShutdown(() => resolve()),
    );
  });

  it("returns the list of active camera ids", async () => {
    handles.state.cameras = ["cam-1", "cam-2", "cam-3"];
    expect(await client.getActiveCameraIds()).toEqual([
      "cam-1",
      "cam-2",
      "cam-3",
    ]);
  });

  it("returns an empty list when no cameras are active", async () => {
    expect(await client.getActiveCameraIds()).toEqual([]);
  });

  it("fetches a camera texture with metadata", async () => {
    const texture = Buffer.from([0xff, 0xd8, 0xff, 0xe0]); // JPEG SOI
    handles.state.textureByCamera.set("cam-1", {
      cameraId: "cam-1",
      cameraName: "Forward Hullcam",
      speed: "1234.5",
      altitude: "75000",
      texture,
    });

    const frame = await client.getCameraTexture("cam-1");
    expect(frame.cameraId).toBe("cam-1");
    expect(frame.cameraName).toBe("Forward Hullcam");
    expect(frame.speed).toBe("1234.5");
    expect(frame.altitude).toBe("75000");
    expect(Buffer.from(frame.texture).equals(texture)).toBe(true);
  });

  it("rejects getCameraTexture when the camera is unknown", async () => {
    await expect(client.getCameraTexture("missing")).rejects.toMatchObject({
      code: grpc.status.NOT_FOUND,
    });
  });

  it("returns average fps", async () => {
    handles.state.averageFps = 42;
    expect(await client.getAverageFps()).toBe(42);
  });
});
