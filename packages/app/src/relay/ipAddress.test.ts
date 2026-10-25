import { describe, expect, it } from "vitest";
import { isIpAddress, isIpv6 } from "./ipAddress";

describe("an IP address the player types", () => {
  it.each([
    "203.0.113.1",
    "0.0.0.0",
    "255.255.255.255",
    "2001:db8:0:0:0:0:0:1",
    "2001:db8::1",
    "::1",
    "::",
    "fe80::1",
    "fe80::1%eth0",
    "fe80::a:b%en0",
    "::ffff:203.0.113.1",
    "2001:DB8::ABCD",
    " 203.0.113.1 ",
  ])("takes %s", (text) => {
    expect(isIpAddress(text)).toBe(true);
  });

  it.each([
    "",
    "203.0.113",
    "256.0.0.1",
    "1.2.3.4.5",
    "01.2.3.4",
    "router.local",
    "localhost",
    "2001:db8::1::2",
    "2001:db8:0:0:0:0:0:0:1",
    "gggg::1",
    "12345::1",
    "fe80::1%",
    "fe80::1%eth 0",
    "203.0.113.1%eth0",
    ":1",
    "1:",
  ])("refuses %s", (text) => {
    expect(isIpAddress(text)).toBe(false);
  });

  it("tells an IPv6 address from an IPv4 one", () => {
    expect(isIpv6("2001:db8::1")).toBe(true);
    expect(isIpv6("fe80::1%eth0")).toBe(true);
    expect(isIpv6("203.0.113.1")).toBe(false);
  });
});
