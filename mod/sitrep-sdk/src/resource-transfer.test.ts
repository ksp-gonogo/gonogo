import { describe, expect, it } from "vitest";
import {
  KspTankFlowMode,
  type ResourceTransferJob,
  TransferJobState,
  type TransferReach,
} from "./__generated__/contract";
import {
  canTransferBetween,
  type TransferPartSource,
  type TransferPick,
  type TransferTank,
  transferableResources,
  transferBlockReason,
  transferPickProblem,
  transferSideLabel,
  transferStartArgs,
  transferTanks,
} from "./resource-transfer";
import { value } from "./unit-system/value";

const tank = (over: Partial<TransferTank> = {}): TransferTank => ({
  partId: "1",
  title: "FL-T400",
  amount: value("units", 10),
  capacity: value("units", 100),
  flowMode: KspTankFlowMode.Both,
  locked: false,
  ...over,
});
const pick = (over: Partial<TransferPick> = {}): TransferPick => ({
  resource: "LiquidFuel",
  from: [],
  to: [],
  ...over,
});
const titleOf = (id: string) => `T${id}`;

const reach: TransferReach = {
  obeysCrossfeed: true,
  sets: [
    { id: 0, partIds: ["1", "2"] },
    { id: 1, partIds: ["3"] },
  ],
  resources: {
    LiquidFuel: [
      { partId: "1", drawsFromSet: 0 },
      { partId: "2", drawsFromSet: 0 },
      { partId: "3", drawsFromSet: 1 },
    ],
    EVAPropellant: [{ partId: "1" }, { partId: "2" }],
  },
  meta: { source: "" },
};

const parts: TransferPartSource[] = [
  {
    id: "1",
    title: "A",
    resources: {
      LiquidFuel: {
        transferable: true,
        amount: value("units", 5),
        maxAmount: value("units", 10),
        flowMode: KspTankFlowMode.Out,
        locked: true,
      },
      SolidFuel: {
        transferable: false,
        amount: value("units", 1),
        maxAmount: value("units", 1),
      },
    },
  },
  {
    id: "2",
    title: "B",
    resources: {
      LiquidFuel: { transferable: true },
      Ore: { transferable: true },
    },
  },
];

describe("transferTanks", () => {
  it("reads only transferable tanks of the resource, with their limits", () => {
    expect(transferTanks(parts, "LiquidFuel")[0]).toEqual({
      partId: "1",
      title: "A",
      amount: value("units", 5),
      capacity: value("units", 10),
      flowMode: KspTankFlowMode.Out,
      locked: true,
    });
    expect(transferTanks(parts, "SolidFuel")).toEqual([]);
  });
});

describe("transferableResources", () => {
  it("needs two transferable tanks", () => {
    expect(transferableResources(parts)).toEqual(["LiquidFuel"]);
  });
});

describe("canTransferBetween", () => {
  it("allows anything when the save does not obey crossfeed", () => {
    expect(
      canTransferBetween(
        { ...reach, obeysCrossfeed: false },
        "LiquidFuel",
        "3",
        "1",
      ),
    ).toBe(true);
  });
  it("allows a vessel-wide resource", () => {
    expect(canTransferBetween(reach, "Xenon", "3", "1")).toBe(true);
  });
  it("needs the source in the set the destination draws from", () => {
    expect(canTransferBetween(reach, "LiquidFuel", "2", "1")).toBe(true);
    expect(canTransferBetween(reach, "LiquidFuel", "3", "1")).toBe(false);
  });
  it("lets a tank with no set draw only from itself", () => {
    expect(canTransferBetween(reach, "EVAPropellant", "2", "1")).toBe(false);
  });
});

describe("transferBlockReason", () => {
  const reason = (
    t: TransferTank,
    role: "from" | "to",
    p = pick(),
    jobs: ResourceTransferJob[] = [],
  ) => transferBlockReason(t, role, p, reach, jobs, titleOf);

  it("offers a plain tank on either side", () => {
    expect(reason(tank(), "from")).toBeUndefined();
    expect(reason(tank(), "to")).toBeUndefined();
  });
  it("does not block a locked tank", () => {
    expect(reason(tank({ locked: true }), "from")).toBeUndefined();
  });
  it("names direction limits", () => {
    expect(reason(tank({ flowMode: KspTankFlowMode.Out }), "to")).toBe(
      "out only",
    );
    expect(
      reason(tank({ flowMode: KspTankFlowMode.Out }), "from"),
    ).toBeUndefined();
    expect(reason(tank({ flowMode: KspTankFlowMode.In }), "from")).toBe(
      "in only",
    );
    expect(reason(tank({ flowMode: KspTankFlowMode.None }), "from")).toBe(
      "set not to flow",
    );
  });
  it("blocks a tank already moving this resource and not another", () => {
    const job = {
      resource: "LiquidFuel",
      fromPartIds: ["1"],
      toPartIds: ["9"],
      state: TransferJobState.Running,
    } as ResourceTransferJob;
    expect(reason(tank(), "from", pick(), [job])).toBe("already in a transfer");
    expect(
      reason(tank(), "from", pick({ resource: "Ore" }), [job]),
    ).toBeUndefined();
  });
  it("names the tank it is measured against, and follows direction", () => {
    expect(reason(tank({ partId: "1" }), "to", pick({ from: ["3"] }))).toBe(
      "not connected by crossfeed to T3",
    );
    expect(reason(tank({ partId: "3" }), "from", pick({ to: ["1"] }))).toBe(
      "not connected by crossfeed to T1",
    );
  });
});

describe("sending a pick", () => {
  it("says what is missing", () => {
    expect(transferPickProblem(pick(), null)).toBe("pick a tank to draw from");
    expect(transferPickProblem(pick({ from: ["1"] }), null)).toBe(
      "pick a tank to fill",
    );
    expect(transferPickProblem(pick({ from: ["1"], to: ["2"] }), 0)).toBe(
      "enter an amount above zero",
    );
    expect(
      transferPickProblem(pick({ from: ["1"], to: ["2"] }), null),
    ).toBeUndefined();
  });
  it("builds until-full and amount arguments", () => {
    const p = pick({ from: ["1"], to: ["2"] });
    expect(transferStartArgs(p, null)).toMatchObject({
      untilFull: true,
      amount: undefined,
    });
    expect(transferStartArgs(p, 5)).toMatchObject({
      untilFull: false,
      amount: 5,
    });
  });
});

describe("transferSideLabel", () => {
  it("names one tank, several of a kind, or a count", () => {
    expect(transferSideLabel(["1"], () => "FL-T400")).toBe("FL-T400");
    expect(transferSideLabel(["1", "2"], () => "FL-T400")).toBe("FL-T400 ×2");
    expect(transferSideLabel(["1", "2"], titleOf)).toBe("2 tanks");
  });
});
