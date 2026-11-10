import { logger } from "@ksp-gonogo/logger";
import { afterEach, describe, expect, it } from "vitest";
import { stampBootRole } from "./bootIdentity";

function visit(path: string): void {
  globalThis.history.replaceState(null, "", path);
}

describe("stampBootRole", () => {
  afterEach(() => {
    visit("/");
    logger.setIdentity({ role: "unknown" });
  });

  it.each([
    ["/", "host"],
    ["/station", "station"],
    ["/pilot", "pilot"],
  ] as const)("files a load at %s as %s", (path, role) => {
    visit(path);
    stampBootRole();
    expect(logger.getIdentity().role).toBe(role);
  });
});
