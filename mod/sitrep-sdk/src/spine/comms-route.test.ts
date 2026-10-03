import { describe, expect, it } from "vitest";
import { value } from "../unit-system/value";
import {
  holdsAt,
  nextDepartureUt,
  readRouteDelays,
  readRouteRows,
} from "./comms-route";

const payload = {
  routes: [
    {
      from: "ground:ksc",
      to: "vessel:probe",
      sentUt: value("ut", 100),
      arrivalUt: value("ut", 101),
      live: true,
      holds: [],
    },
    {
      from: "vessel:probe",
      to: "ground:ksc",
      sentUt: value("ut", 100),
      arrivalUt: value("ut", 2500),
      live: false,
      holds: [
        {
          at: "vessel:probe",
          arriveUt: value("ut", 100),
          departUt: value("ut", 900),
        },
        {
          at: "vessel:relay",
          arriveUt: value("ut", 901),
          departUt: value("ut", 2499),
        },
      ],
    },
    {
      from: "vessel:probe",
      to: "ground:island",
      sentUt: 100,
      arrivalUt: null,
      live: false,
      holds: [],
    },
  ],
};

/** The rows of `payload`, failing the test rather than asserting them present. */
function rows() {
  const read = readRouteRows(payload);
  if (read === null)
    throw new Error("the fixture is not a comms.route payload");
  return read;
}

function row(index: number) {
  const found = rows()[index];
  if (found === undefined) throw new Error("no row " + index);
  return found;
}

describe("comms.route readers", () => {
  it("reads every row with its holds, and an absent arrival as no route", () => {
    expect(rows()).toHaveLength(3);
    expect(row(1).holds.map((h) => h.at)).toEqual([
      "vessel:probe",
      "vessel:relay",
    ]);
    expect(row(2).arrivalUt).toBeUndefined();
    expect(readRouteRows({ nothing: true })).toBeNull();
  });

  it("gives each centre's downlink delay, waits included, and leaves out a centre with no route", () => {
    const delays = readRouteDelays(payload);

    expect(delays?.get("vessel:probe")?.seconds).toEqual(value("s", 1));
    expect(delays?.get("vessel:probe")?.live).toBe(true);
    expect(delays?.get("ground:ksc")?.seconds).toEqual(value("s", 2400));
    expect(delays?.get("ground:ksc")?.live).toBe(false);
    expect(delays?.has("ground:island")).toBe(false);
  });

  it("counts down to the next predicted departure from a hold", () => {
    expect(nextDepartureUt(row(1), value("ut", 100))).toEqual(value("ut", 900));
    expect(nextDepartureUt(row(1), value("ut", 1000))).toEqual(
      value("ut", 2499),
    );
    expect(nextDepartureUt(row(1), value("ut", 3000))).toBeUndefined();
    expect(nextDepartureUt(row(0), value("ut", 100))).toBeUndefined();
  });

  it("lists what one node is predicted to hold, in time order", () => {
    expect(holdsAt(rows(), "vessel:relay")).toEqual([
      {
        at: "vessel:relay",
        arriveUt: value("ut", 901),
        departUt: value("ut", 2499),
      },
    ]);
  });
});
