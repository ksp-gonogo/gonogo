import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRegistry } from "./registry";

const URL = "/uplinks/registry.local.json";

/**
 * A real `Response`, not a shaped object. The whole subject of the two tests
 * below is what the platform does with a body that is not JSON, and a hand-
 * rolled `json: async () => { throw }` would be asserting my own guess about
 * that rather than the behaviour the browser has.
 */
function serve(body: string, init?: ResponseInit): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, init)),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reading the Uplink index", () => {
  it("returns a well-formed index", async () => {
    serve(JSON.stringify({ uplinks: [] }), {
      headers: { "content-type": "application/json" },
    });
    await expect(fetchRegistry({ url: URL })).resolves.toEqual({ uplinks: [] });
  });

  /**
   * The dev server answers a path it does not have with the app shell, at HTTP
   * 200 and `text/html`. So an index that was never built arrives as a healthy
   * response whose body starts with `<`, and the only thing the loader could
   * say about it was `Unexpected token '<'`: true, useless, and about JSON
   * syntax rather than about a build that has not been run.
   */
  it("reads an HTML answer as an absent index, and names the fix", async () => {
    serve('<!DOCTYPE html>\n<html lang="en"><head></head></html>', {
      headers: { "content-type": "text/html" },
    });
    await expect(fetchRegistry({ url: URL })).rejects.toThrow(
      /no Uplink index at .*vite preview/s,
    );
  });

  it("still reports a genuinely malformed index as unparseable", async () => {
    serve('{ "uplinks": [', {
      headers: { "content-type": "application/json" },
    });
    await expect(fetchRegistry({ url: URL })).rejects.toThrow(
      /could not be read as JSON/,
    );
  });

  it("reports a failed fetch by status", async () => {
    serve("nope", { status: 503 });
    await expect(fetchRegistry({ url: URL })).rejects.toThrow(/HTTP 503/);
  });

  it("refuses a body that is JSON but not an index", async () => {
    serve(JSON.stringify({ nope: true }), {
      headers: { "content-type": "application/json" },
    });
    await expect(fetchRegistry({ url: URL })).rejects.toThrow(
      /not a valid index/,
    );
  });
});
