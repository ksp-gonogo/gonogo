import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import {
  formatDuration,
  kspCalendar,
  MissionDate,
  setKspCalendar,
} from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { KspCalendarObserver } from "./KspCalendarObserver";

/**
 * The whole point of the channel, end to end: a duration rendered anywhere in
 * the app has to be measured on the calendar the GAME is running.
 *
 * Before this observer existed the kit compiled in Kerbin's 6-hour day, so a
 * player on RSS, or simply one who turned the stock `KERBIN_TIME` setting off,
 * saw every duration reported as four times too many days and every mission
 * date on a calendar the game does not use. Nothing about those numbers looks
 * wrong on screen, which is why it survived so long.
 */

afterEach(() => {
  // Module state in the kit: leak it and the next test in this file, or any
  // other, formats on somebody else's calendar.
  setKspCalendar();
});

describe("KspCalendarObserver", () => {
  it("leaves the stock fallback alone until the game says otherwise", () => {
    const fixture = setupStreamFixture({ carriedChannels: ["time.calendar"] });
    render(
      <fixture.Provider>
        <KspCalendarObserver />
      </fixture.Provider>,
    );

    // An older mod build serves no such channel. That must behave exactly as
    // the app did before it existed, not render blanks.
    expect(kspCalendar().day).toBe(21_600);
    expect(formatDuration(86_400)).toBe("4d");
  });

  it("adopts an Earth calendar off the stream, and every readout follows", async () => {
    const fixture = setupStreamFixture({ carriedChannels: ["time.calendar"] });
    const tree = () => (
      <fixture.Provider>
        <KspCalendarObserver />
        {/* The public surface for a date: `formatKspDate` is internal, and a
            player reads this component, not the function. */}
        <MissionDate value={86_400} />
      </fixture.Provider>
    );
    const { rerender } = render(tree());

    act(() => {
      fixture.emit("time.calendar", {
        minuteSeconds: 60,
        hourSeconds: 3600,
        daySeconds: 86_400,
        yearSeconds: 365 * 86_400,
        kerbinTime: false,
      });
      // Nothing else reveals a sample: the store hands a payload to readers on
      // a frame, and the view clock has to have reached its validAt.
      fixture.wall.advanceBy(1);
      fixture.store.beginFrame();
    });

    await waitFor(() => expect(kspCalendar().day).toBe(86_400));
    expect(formatDuration(86_400)).toBe("1d");

    // `setKspCalendar` writes module state, so a component that already
    // rendered keeps whatever it formatted with: this rerender is standing in
    // for the next telemetry tick, which in a live app is milliseconds away
    // and re-renders everything anyway. Asserted explicitly rather than
    // glossed, because it IS the limitation: a widget showing a fixed date and
    // nothing else would hold a stale calendar until something re-rendered it.
    rerender(tree());
    // One real day in reads as D2 on an Earth calendar; on Kerbin's it is D5,
    // which is what this same assertion sees before the rerender.
    await waitFor(() => expect(visibleText()).toContain("Y1 D2 00:00:00"));
  });

  it("keeps the stock fallback when the game reports a day nobody can divide by", async () => {
    const fixture = setupStreamFixture({ carriedChannels: ["time.calendar"] });
    render(
      <fixture.Provider>
        <KspCalendarObserver />
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("time.calendar", {
        minuteSeconds: 60,
        hourSeconds: 3600,
        daySeconds: 0,
        yearSeconds: 0,
        kerbinTime: true,
      });
      fixture.wall.advanceBy(1);
      fixture.store.beginFrame();
    });

    // Dividing by it would render every duration in the app as infinity.
    // Waited on rather than asserted immediately, so this cannot pass merely
    // because the payload had not arrived yet: the sibling test above proves
    // an arriving calendar DOES land through the same path.
    await waitFor(() => expect(kspCalendar().day).toBe(21_600));
    expect(formatDuration(86_400)).toBe("4d");
  });
});
