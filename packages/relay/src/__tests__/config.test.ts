import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

describe("loadConfig", () => {
  it("reads extra app origins and refuses one that is not an origin", () => {
    expect(loadConfig({}).appOrigins).toEqual([]);
    expect(
      loadConfig({
        RELAY_APP_ORIGINS: " http://198.51.100.20:8080/ ,https://fork.example",
      }).appOrigins,
    ).toEqual(["http://198.51.100.20:8080", "https://fork.example"]);
    expect(() => loadConfig({ RELAY_APP_ORIGINS: "198.51.100.20" })).toThrow(
      /RELAY_APP_ORIGINS entry "198.51.100.20"/,
    );
  });

  it("discovers the public IP unless PUBLIC_IP pins one", () => {
    expect(loadConfig({}).publicIp).toBeNull();
    expect(loadConfig({ PUBLIC_IP: " 203.0.113.7 " }).publicIp).toBe(
      "203.0.113.7",
    );
  });

  it("leaves the router alone unless GONOGO_UPNP is set", () => {
    expect(loadConfig({}).portMapping).toBe(false);
    expect(loadConfig({ GONOGO_UPNP: "0" }).portMapping).toBe(false);
    expect(loadConfig({ GONOGO_UPNP: "1" }).portMapping).toBe(true);
    expect(loadConfig({ GONOGO_UPNP: "true" }).portMapping).toBe(true);
  });

  it("puts the endpoint on 47100 unless ENDPOINT_PORT says otherwise", () => {
    expect(loadConfig({}).endpointPort).toBe(47100);
    expect(loadConfig({ ENDPOINT_PORT: "47200" }).endpointPort).toBe(47200);
    expect(loadConfig({ ENDPOINT_PORT: "nope" }).endpointPort).toBe(47100);
  });

  it("runs the endpoint unless SKIP_ENDPOINT is set", () => {
    expect(loadConfig({}).skipEndpoint).toBe(false);
    expect(loadConfig({ SKIP_ENDPOINT: "1" }).skipEndpoint).toBe(true);
  });

  it("looks for the endpoint binary beside the relay's files unless ENDPOINT_BIN names one", () => {
    expect(loadConfig({}).endpointBinary).toMatch(/endpoint\/gonogo-endpoint$/);
    expect(loadConfig({ ENDPOINT_BIN: "/opt/e" }).endpointBinary).toBe(
      "/opt/e",
    );
  });
});
