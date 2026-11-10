import { logger } from "@ksp-gonogo/logger";
import { afterEach, describe, expect, it } from "vitest";
import { stampBootRole } from "./bootIdentity";
import { setJoined, setStartSeat } from "./seatChoice";

function visit(path: string): void {
  globalThis.history.replaceState(null, "", path);
}

describe("stampBootRole", () => {
  afterEach(() => {
    visit("/");
    localStorage.clear();
    logger.setIdentity({ role: "unknown" });
  });

  it("files the local screen as the host, or as a pilot when it sits as one", () => {
    visit("/");
    stampBootRole();
    expect(logger.getIdentity().role).toBe("host");
    setStartSeat("pilot");
    stampBootRole();
    expect(logger.getIdentity().role).toBe("pilot");
  });

  it("files a joined screen by the seat it took", () => {
    visit("/join?ABC234");
    stampBootRole();
    expect(logger.getIdentity().role).toBe("station");
    setJoined({ code: "ABC234", seat: "pilot" });
    stampBootRole();
    expect(logger.getIdentity().role).toBe("pilot");
  });
});
