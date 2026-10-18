import { describe, expect, it } from "vitest";
import { scrubEntry } from "./scrub.js";

function stackOf(stack: string): string {
  const out = scrubEntry({
    level: "error",
    message: "boom",
    timestamp: 0,
    error: { name: "Error", message: "boom", stack },
  } as never).error?.stack;
  return out ?? "";
}

describe("scrubEntry stack traces", () => {
  it("keeps the path and line:col of a Chromium frame and masks the origin", () => {
    const out = stackOf(
      "Error: boom\n    at render (https://gonogo.example.com:8443/assets/index-AbC123.js:1:2345)\n    at https://gonogo.example.com:8443/assets/vendor-x.js:10:20",
    );
    expect(out).toContain("/assets/index-AbC123.js:1:2345)");
    expect(out).toContain("/assets/vendor-x.js:10:20");
    expect(out).not.toContain("gonogo.example.com");
    expect(out).toMatch(/at render \(<url:[0-9a-f]{8}>\/assets/);
  });

  it("keeps a Firefox frame readable", () => {
    const out = stackOf(
      "render@http://203.0.113.20:5173/assets/index-x.js:1:2345\nnext@http://203.0.113.20:5173/assets/index-x.js:7:8",
    );
    expect(out).toContain("render@<url:");
    expect(out).toContain("/assets/index-x.js:1:2345\n");
    expect(out).toContain("/assets/index-x.js:7:8");
    expect(out).not.toContain("203.0.113");
  });

  it("keeps a Safari frame readable and drops a cache-busting query", () => {
    const out = stackOf(
      "render@https://host.local/assets/index-x.js?v=9a:1:2345\nglobal code@https://host.local/assets/index-x.js:3:4",
    );
    expect(out).toContain("/assets/index-x.js:1:2345");
    expect(out).not.toContain("?v=9a");
    expect(out).toContain("/assets/index-x.js:3:4");
    expect(out).not.toContain("host.local");
  });

  it("gives the same origin the same tag so frames still correlate", () => {
    const out = stackOf(
      "a@https://h.example/a.js:1:1\nb@https://h.example/b.js:2:2",
    );
    const tags = out.match(/<url:[0-9a-f]{8}>/g);
    expect(tags).toHaveLength(2);
    expect(tags?.[0]).toBe(tags?.[1]);
  });

  it("masks a URL with no authority whole", () => {
    const out = stackOf("at f (file:///srv/builds/app/a.js:1:2)");
    expect(out).not.toContain("builds");
  });

  it("still masks a URL in the message", () => {
    const out = scrubEntry({
      level: "error",
      message: "failed https://h.example/secret/path?x=1",
      timestamp: 0,
    } as never);
    expect(out.message).not.toContain("secret");
  });
});
