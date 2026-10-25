import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { SettingsService } from "../settings/SettingsService";
import {
  AUTO_PORT_FORWARD_SETTING,
  COMPUTER_ADDRESS_SETTING,
  isRouterAddress,
  postAutoPortForward,
  ROUTER_ADDRESS_SETTING,
  readPortForward,
  refuseAddress,
  syncAutoPortForward,
} from "./autoPortForward";

const posted: unknown[] = [];
const server = setupServer(
  http.post("http://localhost:3002/port-forward", async ({ request }) => {
    posted.push(await request.json());
    return HttpResponse.json({ enabled: true, portMapping: null });
  }),
  http.get("http://localhost:3002/port-forward", () =>
    HttpResponse.json({
      enabled: true,
      portMapping: { state: "refused", message: "Your router refused" },
    }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => {
  posted.length = 0;
  localStorage.clear();
});
afterAll(() => server.close());

describe("automatic port forwarding setting", () => {
  it("leaves the relay's own starting value alone until the player chooses", () => {
    const settings = new SettingsService();
    const post = vi.fn(async () => {});
    const stop = syncAutoPortForward(settings, post);
    expect(post).not.toHaveBeenCalled();
    settings.set(AUTO_PORT_FORWARD_SETTING, true);
    expect(post).toHaveBeenLastCalledWith({ enabled: true });
    stop();
    settings.dispose();
  });

  it("sends a choice already made as soon as it starts", () => {
    const settings = new SettingsService();
    settings.set(AUTO_PORT_FORWARD_SETTING, false);
    const post = vi.fn(async () => {});
    const stop = syncAutoPortForward(settings, post);
    expect(post).toHaveBeenCalledWith({ enabled: false });
    stop();
    settings.dispose();
  });

  it("sends the router address with the switch once it is a valid one", () => {
    const settings = new SettingsService();
    const post = vi.fn(async () => {});
    const stop = syncAutoPortForward(settings, post);
    settings.set(AUTO_PORT_FORWARD_SETTING, true);
    settings.set(ROUTER_ADDRESS_SETTING, "203.0.113");
    expect(post).toHaveBeenLastCalledWith({ enabled: true });
    settings.set(ROUTER_ADDRESS_SETTING, "203.0.113.1");
    expect(post).toHaveBeenLastCalledWith({
      enabled: true,
      routerIp: "203.0.113.1",
    });
    stop();
    settings.dispose();
  });

  it("sends this computer's address with the router's once it is a valid one", () => {
    const settings = new SettingsService();
    const post = vi.fn(async () => {});
    const stop = syncAutoPortForward(settings, post);
    settings.set(AUTO_PORT_FORWARD_SETTING, true);
    settings.set(ROUTER_ADDRESS_SETTING, "203.0.113.1");
    settings.set(COMPUTER_ADDRESS_SETTING, "203.0.113.20");
    expect(post).toHaveBeenLastCalledWith({
      enabled: true,
      routerIp: "203.0.113.1",
      lanIp: "203.0.113.20",
    });
    stop();
    settings.dispose();
  });

  it("refuses a typed address that is not one, and accepts an empty field", () => {
    expect(refuseAddress("")).toBeUndefined();
    expect(refuseAddress("203.0.113.1")).toBeUndefined();
    expect(refuseAddress("2001:db8::1")).toBeUndefined();
    expect(refuseAddress("203.0.113")).toBe("That is not an IP address.");
  });

  it("takes an IPv4 or IPv6 address as a router address, and nothing else", () => {
    expect(isRouterAddress("203.0.113.1")).toBe(true);
    expect(isRouterAddress(" 203.0.113.1 ")).toBe(true);
    expect(isRouterAddress("fe80::1%eth0")).toBe(true);
    for (const bad of [
      "203.0.113",
      "256.0.0.1",
      "router.local",
      "",
      "1.2.3.4.5",
    ]) {
      expect(isRouterAddress(bad)).toBe(false);
    }
  });

  it("posts the switch to the relay and reads back where the forward stands", async () => {
    await postAutoPortForward({ enabled: true, routerIp: "203.0.113.1" });
    expect(posted).toEqual([{ enabled: true, routerIp: "203.0.113.1" }]);
    expect(await readPortForward()).toEqual({
      enabled: true,
      mapping: { state: "refused", message: "Your router refused" },
    });
  });
});
