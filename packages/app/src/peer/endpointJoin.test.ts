import { describe, expect, it } from "vitest";
import { joinMetadata, readJoin } from "./endpointJoin";

describe("endpoint joins in connection metadata", () => {
  it("reads back the join it wrote", () => {
    const join = { kind: "join", id: "gne-1", sdp: "v=0" } as const;
    expect(readJoin(joinMetadata(join))).toEqual(join);
  });

  it("reads back an answer", () => {
    const answer = { kind: "answer", id: "gne-1", sdp: "v=0" } as const;
    expect(readJoin(joinMetadata(answer))).toEqual(answer);
  });

  it("finds nothing in an ordinary connection's metadata", () => {
    expect(readJoin(undefined)).toBeNull();
    expect(readJoin({ station: "A" })).toBeNull();
    expect(
      readJoin({ gonogoEndpoint: { kind: "nonsense", id: "x", sdp: "v=0" } }),
    ).toBeNull();
    expect(
      readJoin({ gonogoEndpoint: { kind: "join", sdp: "v=0" } }),
    ).toBeNull();
  });
});
