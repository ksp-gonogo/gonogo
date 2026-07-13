import {
  getGameHost,
  resetSettingsForTests,
  setSetting,
} from "@ksp-gonogo/core";
import { afterEach, describe, expect, it } from "vitest";
import { migrateGameHost } from "./migrateGameHost";

afterEach(() => {
  resetSettingsForTests();
  localStorage.clear();
});

describe("migrateGameHost", () => {
  it("carries an old saved sitrep host into gameHost when unset", () => {
    localStorage.setItem(
      "gonogo.datasource.sitrep",
      JSON.stringify({ host: "old-box", port: 8090 }),
    );
    migrateGameHost();
    expect(getGameHost()).toBe("old-box");
  });

  it("does not overwrite an already-set gameHost", () => {
    setSetting("gameHost", "current");
    localStorage.setItem(
      "gonogo.datasource.sitrep",
      JSON.stringify({ host: "old-box", port: 8090 }),
    );
    migrateGameHost();
    expect(getGameHost()).toBe("current");
  });

  it("is a no-op when there is no old host", () => {
    migrateGameHost();
    expect(getGameHost()).toBe("localhost");
  });
});
