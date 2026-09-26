import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * An emit on a topic nothing subscribes to renders exactly like the empty state and passes the visual gate unnoticed.
 * So every emitted channel must be covered by something the fixture claims to carry, exactly or by a declared prefix: a dynamic namespace such as `fleet.<guid>.contact` is carried by its prefix.
 */
describe("SystemView probe fixtures", () => {
  const dir = join(__dirname, "__fixtures__");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

  it("has fixtures to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s carries every channel it emits", (file) => {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const block: unknown =
      typeof parsed === "object" && parsed !== null
        ? Reflect.get(parsed, "_stream")
        : undefined;
    const stream =
      typeof block === "object" && block !== null
        ? (block as {
            carriedChannels?: string[];
            emits?: { channel: string }[];
          })
        : undefined;
    if (!stream?.emits) return;

    const carried = stream.carriedChannels ?? [];
    const uncovered = stream.emits
      .map((e) => e.channel)
      .filter(
        (channel) =>
          !carried.some(
            (c) => c === channel || (c.endsWith(".") && channel.startsWith(c)),
          ),
      );

    expect(uncovered).toEqual([]);
  });
});
