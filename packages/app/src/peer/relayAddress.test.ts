import { afterEach, describe, expect, it, vi } from "vitest";
import { relayBaseUrl } from "./relayAddress";

function servedFrom(url: string) {
  vi.stubGlobal("location", new URL(url));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("relayBaseUrl", () => {
  it("is this machine when the page is served from it", () => {
    servedFrom("http://localhost:8080/pilot");
    expect(relayBaseUrl()).toBe("http://localhost:3002");
  });

  it("is the page's own host at port 3002 when served to another device", () => {
    servedFrom("http://192.0.2.20:8080/pilot");
    expect(relayBaseUrl()).toBe("http://192.0.2.20:3002");
  });

  it("is this machine on the hosted https site", () => {
    servedFrom("https://ksp-gonogo.github.io/rc/pilot");
    expect(relayBaseUrl()).toBe("http://localhost:3002");
  });

  it("lets VITE_RELAY_URL override the page's host", () => {
    servedFrom("http://192.0.2.20:8080/");
    vi.stubEnv("VITE_RELAY_URL", "http://relay.example:4000/");
    expect(relayBaseUrl()).toBe("http://relay.example:4000");
  });
});
