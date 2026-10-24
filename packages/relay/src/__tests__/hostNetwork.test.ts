import { describe, expect, it } from "vitest";
import {
  parseLinuxRoute,
  parseMacRoute,
  parseWindowsRoute,
} from "../../../../scripts/host-network.mjs";

describe("host default route", () => {
  it("reads the gateway and interface from macOS", () => {
    const out = `   route to: default\ndestination: default\n       mask: default\n    gateway: 198.51.100.1\n  interface: en0\n      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING,GLOBAL>\n`;
    expect(parseMacRoute(out)).toEqual({
      gateway: "198.51.100.1",
      iface: "en0",
    });
  });

  it("gives no gateway for a link-scoped macOS route", () => {
    expect(
      parseMacRoute("    gateway: fe80::%utun0\n  interface: utun0\n").gateway,
    ).toBeNull();
  });

  it("reads the gateway and source address from Linux", () => {
    const out =
      "1.1.1.1 via 203.0.113.1 dev eth0 src 203.0.113.42 uid 1000 \\    cache";
    expect(parseLinuxRoute(out)).toEqual({
      gateway: "203.0.113.1",
      lanIp: "203.0.113.42",
    });
  });

  it("takes the lowest-metric default route from Windows", () => {
    const out = [
      "IPv4 Route Table",
      "          0.0.0.0          0.0.0.0     198.51.100.2   198.51.100.50     50",
      "          0.0.0.0          0.0.0.0      203.0.113.1       203.0.113.7      5",
      "        127.0.0.0        255.0.0.0         On-link      127.0.0.1    331",
    ].join("\r\n");
    expect(parseWindowsRoute(out)).toEqual({
      gateway: "203.0.113.1",
      lanIp: "203.0.113.7",
    });
  });

  it("gives nothing when no default route is listed", () => {
    expect(parseWindowsRoute("IPv4 Route Table\r\n")).toBeNull();
  });
});
