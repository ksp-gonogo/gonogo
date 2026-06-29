import { kerbcastSource } from "@gonogo/kerbcast";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { kosSource } from "../dataSources/kos";
import { seedKspHostDefaults } from "../dataSources/seedKspHost";
import { telemachusSource } from "../dataSources/telemachus";

const BOOTSTRAP_URL = "http://localhost:3002/bootstrap-config";
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

beforeEach(() => {
  localStorage.clear();
  // The sources are module singletons shared across tests — reset the
  // in-memory hosts the same way the seed applies them (non-persisting).
  telemachusSource.applySeededHost("localhost");
  kosSource.applySeededConfig({ kosHost: "localhost" });
  kerbcastSource.applySeededHost("127.0.0.1");
});

function bootstrapHandler(kspHost: string | null) {
  return http.get(BOOTSTRAP_URL, () => HttpResponse.json({ kspHost }));
}

describe("seedKspHostDefaults", () => {
  it("seeds Telemachus, kerbcast, and kOS from a LAN KSP_HOST", async () => {
    server.use(bootstrapHandler("192.168.1.50"));

    await seedKspHostDefaults();

    expect(telemachusSource.getConfig().host).toBe("192.168.1.50");
    expect(kerbcastSource.getConfig().host).toBe("192.168.1.50");
    expect(kosSource.getConfig().kosHost).toBe("192.168.1.50");
    // The browser-dialled seeds are in-memory only — nothing persisted, so
    // a changed KSP_HOST takes effect on the next load.
    expect(localStorage.getItem("gonogo.datasource.telemachus")).toBeNull();
    expect(localStorage.getItem("gonogo.datasource.kerbcast")).toBeNull();
    expect(localStorage.getItem("gonogo.datasource.kos")).toBeNull();
  });

  it("maps container-internal hosts to localhost for browser-dialled sources only", async () => {
    server.use(bootstrapHandler("host.docker.internal"));

    await seedKspHostDefaults();

    // The browser can't resolve host.docker.internal — same machine means
    // localhost from its perspective.
    expect(telemachusSource.getConfig().host).toBe("localhost");
    expect(kerbcastSource.getConfig().host).toBe("localhost");
    // The kOS telnet host is dialled by the in-container proxy, where the
    // container-internal name is the correct one.
    expect(kosSource.getConfig().kosHost).toBe("host.docker.internal");
  });

  it("never overrides a user-saved config", async () => {
    localStorage.setItem(
      "gonogo.datasource.telemachus",
      JSON.stringify({ host: "my-ksp-box", port: 8085 }),
    );
    localStorage.setItem(
      "gonogo.datasource.kerbcast",
      JSON.stringify({ host: "my-ksp-box", port: 8088 }),
    );
    localStorage.setItem(
      "gonogo.datasource.kos",
      JSON.stringify({ kosHost: "my-ksp-box" }),
    );
    server.use(bootstrapHandler("192.168.1.50"));

    await seedKspHostDefaults();

    expect(telemachusSource.getConfig().host).toBe("localhost");
    expect(kerbcastSource.getConfig().host).toBe("127.0.0.1");
    expect(kosSource.getConfig().kosHost).toBe("localhost");
  });

  it("is a no-op when the relay reports no KSP_HOST (public deployments)", async () => {
    server.use(bootstrapHandler(null));

    await seedKspHostDefaults();

    expect(telemachusSource.getConfig().host).toBe("localhost");
    expect(kerbcastSource.getConfig().host).toBe("127.0.0.1");
    expect(kosSource.getConfig().kosHost).toBe("localhost");
  });

  it("is a no-op when no relay is reachable (GH Pages / dev without compose)", async () => {
    server.use(http.get(BOOTSTRAP_URL, () => HttpResponse.error()));

    await seedKspHostDefaults();

    expect(telemachusSource.getConfig().host).toBe("localhost");
    expect(kerbcastSource.getConfig().host).toBe("127.0.0.1");
    expect(kosSource.getConfig().kosHost).toBe("localhost");
  });
});
