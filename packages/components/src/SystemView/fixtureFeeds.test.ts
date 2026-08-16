import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A probe fixture that emits a topic nothing is subscribed to renders exactly
 * like a fixture that emits nothing at all: no error, no warning, a perfectly
 * plausible screenshot of the empty state. The visual gate then happily accepts
 * it as the baseline for a feature it never rendered.
 *
 * <p>This bit the contact-state fixtures: they listed the concrete topic
 * `fleet.<guid>.contact` in `carriedChannels`, but a dynamic namespace is
 * carried by its PREFIX (`fleet.`), so the subscription never existed, the
 * emit went to nobody, and all three "new state" renders came out byte-identical
 * to the plain one.</p>
 *
 * So: every emitted channel must be covered by something the fixture claims to
 * carry, either exactly or by a declared prefix.
 */
describe("SystemView probe fixtures", () => {
  const dir = join(__dirname, "__fixtures__");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

  it("has fixtures to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s carries every channel it emits", (file) => {
    const fixture = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
      _stream?: { carriedChannels?: string[]; emits?: { channel: string }[] };
    };
    const stream = fixture._stream;
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
