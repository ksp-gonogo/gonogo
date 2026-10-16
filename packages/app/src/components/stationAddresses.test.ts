import { describe, expect, it } from "vitest";
import {
  PUBLIC_RC_STATION_URL,
  PUBLIC_STATION_URL,
  stationAddresses,
} from "./stationAddresses";

const BASE = { code: "AB3K", baseUrl: "/", appVersion: "1.0.0" };

describe("stationAddresses", () => {
  it("points a self-hosted LAN origin at its own station page and encodes that in the QR", () => {
    const { addresses, qr } = stationAddresses({
      ...BASE,
      origin: "http://192.0.2.20:8080",
    });

    expect(addresses.map((a) => a.url)).toEqual([
      "http://192.0.2.20:8080/station?host=AB3K",
      `${PUBLIC_STATION_URL}?host=AB3K`,
    ]);
    expect(qr.url).toBe("http://192.0.2.20:8080/station?host=AB3K");
  });

  it("encodes the public build in the QR when the page is on localhost, which no phone can reach", () => {
    const { addresses, qr } = stationAddresses({
      ...BASE,
      origin: "http://localhost:8080",
    });

    expect(addresses[0].url).toBe("http://localhost:8080/station?host=AB3K");
    expect(addresses[0].when).toBe("For another window on this computer");
    expect(qr.id).toBe("public");
  });

  it("points a release candidate build at the rc station page, in the list and in the QR", () => {
    const { addresses, qr } = stationAddresses({
      ...BASE,
      appVersion: "1.2.0-rc.a1b2c3d",
      origin: "http://localhost:8080",
    });

    expect(addresses[1].url).toBe(`${PUBLIC_RC_STATION_URL}?host=AB3K`);
    expect(qr.url).toBe("https://ksp-gonogo.github.io/rc/station?host=AB3K");
  });

  it("points a release build at the app station page", () => {
    const { qr } = stationAddresses({
      ...BASE,
      appVersion: "1.2.0",
      origin: "http://localhost:8080",
    });

    expect(qr.url).toBe("https://ksp-gonogo.github.io/app/station?host=AB3K");
  });

  it("offers only the page's own address when it is served from a public origin", () => {
    const { addresses, qr } = stationAddresses({
      ...BASE,
      origin: "https://ksp-gonogo.github.io",
      baseUrl: "/rc/",
    });

    expect(addresses).toHaveLength(1);
    expect(qr.url).toBe("https://ksp-gonogo.github.io/rc/station?host=AB3K");
  });

  it("lets a fork's own deploy replace every other address", () => {
    const { addresses, qr } = stationAddresses({
      ...BASE,
      origin: "http://localhost:5173",
      override: "https://fork.example/station/",
    });

    expect(addresses).toHaveLength(1);
    expect(qr.url).toBe("https://fork.example/station?host=AB3K");
  });

  it("escapes a share code", () => {
    const { qr } = stationAddresses({
      code: "A B",
      appVersion: "1.0.0",
      baseUrl: "/",
      origin: "https://x.example",
    });

    expect(qr.url).toBe("https://x.example/station?host=A%20B");
  });
});
