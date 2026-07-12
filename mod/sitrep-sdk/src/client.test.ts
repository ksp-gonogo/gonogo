import { describe, expect, it } from "vitest";
import { parseServerMessage } from "./client";

describe("parseServerMessage", () => {
  it("parses + narrows a stream-data message", () => {
    const m = parseServerMessage(
      '{"type":"stream-data","topic":"t","payload":1,"meta":{}}',
    );
    expect(m.type).toBe("stream-data");
    if (m.type === "stream-data") expect(m.topic).toBe("t");
  });
  it("throws on an unknown type tag", () => {
    expect(() => parseServerMessage('{"type":"nope"}')).toThrow(
      /unknown envelope type/i,
    );
  });
});
