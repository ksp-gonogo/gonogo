import { type GameLoaded, value } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  render,
  screen,
  setupStreamFixture,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import { isNews, QuickloadBanner, QuickloadSentence } from "./QuickloadBanner";

function event(over: Partial<GameLoaded>): GameLoaded {
  return {
    loadId: "l1",
    outcome: "loaded",
    failReason: null,
    saveUt: value("ut", 100),
    fromUt: value("ut", 500),
    requestedBy: "",
    ...over,
  } as GameLoaded;
}

describe("the quickload banner's words", () => {
  it("names the station that loaded and how far it moved", () => {
    render(<QuickloadSentence event={event({ requestedBy: "Station 3" })} />);
    expect(document.body.textContent).toContain("Quickloaded by Station 3");
    expect(document.body.textContent).toContain("moved");
  });

  it("says a game load with no requester plainly", () => {
    render(<QuickloadSentence event={event({})} />);
    expect(document.body.textContent).toContain("Game loaded ·");
  });

  it("says why a load failed", () => {
    render(
      <QuickloadSentence
        event={event({
          outcome: "failed",
          failReason: "the save is not compatible",
        })}
      />,
    );
    expect(document.body.textContent).toBe(
      "Quickload failed: the save is not compatible",
    );
  });

  it("says a load was cancelled", () => {
    render(<QuickloadSentence event={event({ outcome: "cancelled" })} />);
    expect(document.body.textContent).toBe(
      "Quickload cancelled: the scene changed first",
    );
  });
});

describe("which loads are news", () => {
  it("is news when the view clock is at the load", () => {
    expect(isNews(event({}), value("ut", 510))).toBe(true);
  });

  it("is a replay when the view clock is far past the load", () => {
    expect(isNews(event({}), value("ut", 700))).toBe(false);
  });

  it("is a replay when the view clock sits between the rewound save and the load's own time", () => {
    expect(isNews(event({}), value("ut", 120))).toBe(false);
  });

  it("is news when the view clock has just reached the save", () => {
    expect(isNews(event({}), value("ut", 103))).toBe(true);
  });
});

describe("the quickload banner under signal delay", () => {
  it("shows a load that finished while the view clock lags the load by the delay", async () => {
    const stream = setupStreamFixture({ delaySeconds: 60 });
    render(
      <stream.Provider>
        <QuickloadBanner />
      </stream.Provider>,
    );
    await act(async () => {
      stream.emit(
        "ksp.gameLoaded",
        {
          loadId: "l1",
          outcome: "loaded",
          failReason: null,
          saveUt: 100,
          fromUt: 500,
          requestedBy: "",
        },
        { validAt: 500, deliveredAt: 500 },
      );
      stream.wall.advanceBy(0.1);
      stream.store.beginFrame();
      stream.store.clock.emitFrame();
    });
    expect(screen.getByRole("status").textContent).toContain("Game loaded");
  });
});
