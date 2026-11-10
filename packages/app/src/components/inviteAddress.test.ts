import { describe, expect, it } from "vitest";
import { inviteAddress } from "./inviteAddress";

const base = { code: "AB3K", baseUrl: "/", channel: "app" as const };

describe("inviteAddress", () => {
  it("is this app's own join page on a network address", () => {
    expect(inviteAddress({ ...base, origin: "http://192.0.2.20:8080" })).toBe(
      "http://192.0.2.20:8080/join?AB3K",
    );
  });

  it("keeps the base path of a sub-path deploy", () => {
    expect(
      inviteAddress({
        ...base,
        origin: "https://ksp-gonogo.github.io",
        baseUrl: "/rc/",
        channel: "rc",
      }),
    ).toBe("https://ksp-gonogo.github.io/rc/join?AB3K");
  });

  it("is the public build of the channel on a loopback address", () => {
    expect(inviteAddress({ ...base, origin: "http://localhost:8080" })).toBe(
      "https://ksp-gonogo.github.io/app/join?AB3K",
    );
    expect(
      inviteAddress({
        ...base,
        origin: "http://127.0.0.1:5173",
        channel: "rc",
      }),
    ).toBe("https://ksp-gonogo.github.io/rc/join?AB3K");
  });

  it("is a fork's own deploy when one is set", () => {
    expect(
      inviteAddress({
        ...base,
        origin: "http://localhost:8080",
        override: "https://fork.example/app",
      }),
    ).toBe("https://fork.example/app/join?AB3K");
  });

  it("escapes the code", () => {
    expect(
      inviteAddress({ ...base, origin: "https://x.example", code: "A B" }),
    ).toBe("https://x.example/join?A%20B");
  });
});
