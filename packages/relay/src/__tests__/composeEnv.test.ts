import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Read only by the localhost smoke tests, which start the relay without compose, or fixed by the image. */
const NOT_FOR_COMPOSE = new Set([
  "SKIP_COTURN",
  "SKIP_ENDPOINT",
  "ENDPOINT_BIN",
  "ENDPOINT_CONTROL_PORT",
]);

describe("docker-compose.yml", () => {
  it("passes every variable loadConfig reads to the relay", () => {
    const config = readFileSync(resolve(__dirname, "../config.ts"), "utf8");
    const compose = readFileSync(
      resolve(__dirname, "../../../../docker-compose.yml"),
      "utf8",
    );
    const read = [...config.matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g)].map(
      (m) => m[1],
    );
    expect(read).toContain("TURN_TCP");
    const missing = read.filter(
      (name) =>
        !NOT_FOR_COMPOSE.has(name) &&
        !new RegExp(`^\\s+${name}:`, "m").test(compose),
    );
    expect(missing).toEqual([]);
  });
});
