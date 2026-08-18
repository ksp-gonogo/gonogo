import { useTelemetry } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import {
  formatDuration,
  kspCalendar,
  setKspCalendar,
} from "@ksp-gonogo/ui-kit";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { KspCalendarObserver } from "./KspCalendarObserver";

/**
 * What `KspCalendarObserver` DOES today when `time.calendar` reads `undefined`,
 * recorded before `useTelemetry` starts returning a `Reading`.
 *
 * The observer has no render output, so its whole observable behaviour is a
 * WRITE it either performs or skips, guarded by one four-way absence gate:
 * `day === undefined || year === undefined || hour === undefined || minute ===
 * undefined`. Two undefined-meanings meet in it, and the sibling
 * `KspCalendarObserver.test.tsx` cannot separate them because it asserts the
 * stock fallback value, which is also what a stock WRITE would leave behind:
 *
 * - undefined at the topic level (nothing arrived, or a tombstone) means
 *   "change nothing", which after a calendar has been adopted means "keep it",
 *   not "go back to stock"
 * - undefined at the field level means "apply none of the four", deliberately,
 *   because a half-applied calendar renders dates neither calendar explains
 *
 * These tests seed a SENTINEL calendar before mounting, so a skipped write is
 * distinguishable from a write of the stock numbers.
 */

/** Recognisable, valid, and not the stock figures: survives iff nothing wrote. */
const SENTINEL = { minute: 61, hour: 3601, day: 21_601, year: 9_201_601 };

const CALENDAR_FIELDS = [
  "minuteSeconds",
  "hourSeconds",
  "daySeconds",
  "yearSeconds",
] as const;

/**
 * The raw read, spelled out field by field. Prints both which keys the wire
 * actually carried and what each one's magnitude narrows to, which is the only
 * way to see a field that arrived as `null` (present key, undefined magnitude)
 * apart from one that never arrived at all.
 */
function CalendarProbe() {
  // Branches on the ARM. The two absences used to be `undefined` and `null`, which
  // nothing downstream could reliably separate; they are `pending` and `absent` now
  // and this probe reports which one arrived.
  const reading = useTelemetry("time.calendar");
  if (reading.state === "pending") return <p>calendar:pending</p>;
  if (reading.state === "absent") return <p>calendar:absent</p>;
  const record = reading.value as unknown as Record<
    string,
    { magnitude?: number } | null
  >;
  const magnitudes = CALENDAR_FIELDS.map(
    (field) => `${field}=${record[field]?.magnitude}`,
  ).join(" ");
  return (
    <p>{`calendar:keys=${Object.keys(record).join(",")} ${magnitudes}`}</p>
  );
}

function mount() {
  const fixture = setupStreamFixture({
    carriedChannels: ["time.calendar"],
    pinnedUt: 10,
  });
  const view = render(
    <fixture.Provider>
      <KspCalendarObserver />
      <CalendarProbe />
    </fixture.Provider>,
  );
  return {
    ...fixture,
    ...view,
    emitCalendar: (payload: unknown) => {
      act(() => {
        fixture.emit("time.calendar", payload);
        fixture.store.beginFrame();
      });
    },
  };
}

afterEach(() => {
  // Module state in the kit: leak it and the next test formats on somebody
  // else's calendar.
  setKspCalendar();
});

describe("KspCalendarObserver: what undefined means for time.calendar today", () => {
  it("performs no write at all before the topic arrives, leaving whatever calendar was already in force", () => {
    setKspCalendar(SENTINEL);
    const fixture = mount();

    expect(screen.getByText("calendar:pending")).toBeInTheDocument();
    // The sentinel surviving is the assertion: it proves `setKspCalendar` was
    // never called, which asserting the stock 21,600 could not.
    expect(kspCalendar()).toEqual(SENTINEL);

    fixture.unmount();
  });

  it("applies none of the four when one field is missing, rather than a partial calendar", () => {
    setKspCalendar(SENTINEL);
    const fixture = mount();

    // The record landed; `yearSeconds` did not. A merged write would have been
    // valid (the setter fills gaps from stock), so nothing structural stops a
    // half-applied calendar: only this gate does.
    fixture.emitCalendar({
      minuteSeconds: 60,
      hourSeconds: 3600,
      daySeconds: 86_400,
      kerbinTime: false,
    });

    expect(
      screen.getByText(
        "calendar:keys=minuteSeconds,hourSeconds,daySeconds,kerbinTime minuteSeconds=60 hourSeconds=3600 daySeconds=86400 yearSeconds=undefined",
      ),
    ).toBeInTheDocument();
    expect(kspCalendar()).toEqual(SENTINEL);

    fixture.unmount();
  });

  it("treats a field that arrived as null identically to one that never arrived", () => {
    setKspCalendar(SENTINEL);
    const fixture = mount();

    // `null` is the wire saying this field has no value, a stronger statement
    // than silence. `calendar?.yearSeconds?.magnitude` erases the difference
    // before the gate sees it, so this widget implements `null` as pending.
    fixture.emitCalendar({
      minuteSeconds: 60,
      hourSeconds: 3600,
      daySeconds: 86_400,
      yearSeconds: null,
    });

    // The key IS present on the wire, and the magnitude still reads undefined:
    // that pair is the inversion, visible nowhere else.
    expect(
      screen.getByText(
        "calendar:keys=minuteSeconds,hourSeconds,daySeconds,yearSeconds minuteSeconds=60 hourSeconds=3600 daySeconds=86400 yearSeconds=undefined",
      ),
    ).toBeInTheDocument();
    expect(kspCalendar()).toEqual(SENTINEL);

    fixture.unmount();
  });

  it("latches an adopted calendar: a whole-topic tombstone does not revert to stock", () => {
    const fixture = mount();

    fixture.emitCalendar({
      minuteSeconds: 60,
      hourSeconds: 3600,
      daySeconds: 86_400,
      yearSeconds: 365 * 86_400,
      kerbinTime: false,
    });
    expect(kspCalendar().day).toBe(86_400);
    expect(formatDuration(86_400)).toBe("1d");

    // The topic goes to a confirmed tombstone: the game is no longer reporting
    // a calendar. The gate returns early, so the Earth calendar stays in force
    // for the rest of the session and every duration in the app keeps being
    // measured on it. Recorded as observed behaviour, not endorsed.
    fixture.emitCalendar(null);
    expect(screen.getByText("calendar:absent")).toBeInTheDocument();
    expect(kspCalendar().day).toBe(86_400);
    expect(formatDuration(86_400)).toBe("1d");

    fixture.unmount();
  });
});
