import {
  type CommandArgs,
  type CommandReply,
  KspTankFlowMode,
  type ResourceTransferJob,
  TransferJobState,
  type TransferPick,
  type TransferPickState,
  type TransferTank,
  useTransferPick,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  createFakeCommand,
  render,
  screen,
  waitFor,
  within,
} from "@ksp-gonogo/sitrep-sdk/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ResourceFlowRow } from "./ResourceFlowRow";
import { ResourceTransferPicker } from "./ResourceTransferPicker";
import type { UiResourceTransferModel } from "./resourceTransferModel";
import { expectNoA11yViolations } from "./testing";

const TANKS: TransferTank[] = [
  {
    partId: "1",
    title: "Drop tank",
    amount: value("units", 230.4),
    capacity: value("units", 360),
    flowMode: KspTankFlowMode.Both,
    locked: true,
  },
  {
    partId: "2",
    title: "Radial",
    amount: value("units", 0),
    capacity: value("units", 360),
    flowMode: KspTankFlowMode.Both,
    locked: false,
  },
  {
    partId: "3",
    title: "Lander",
    amount: value("units", 45),
    capacity: value("units", 90),
    flowMode: KspTankFlowMode.Out,
    locked: false,
  },
];

function model(over: Partial<UiResourceTransferModel> = {}) {
  const start = createFakeCommand<
    CommandArgs<"vessel.resource.transfer.start">,
    CommandReply<"vessel.resource.transfer.start">
  >({ answer: "hold" });
  const stop = createFakeCommand<
    CommandArgs<"vessel.resource.transfer.stop">,
    CommandReply<"vessel.resource.transfer.stop">
  >({ answer: "hold" });
  const transfer: UiResourceTransferModel = {
    resources: ["LiquidFuel"],
    running: [],
    held: false,
    tanks: () => TANKS,
    titleOf: (id: string) => TANKS.find((t) => t.partId === id)?.title ?? id,
    blockReason: (tank, role) =>
      tank.flowMode === KspTankFlowMode.Out && role === "to"
        ? "out only"
        : undefined,
    start: start.handle,
    stop: stop.handle,
    ...over,
  };
  return { transfer, start, stop };
}

function Harness({
  transfer,
  seed,
  onStarted,
}: {
  transfer: UiResourceTransferModel;
  seed?: Partial<TransferPick>;
  onStarted?: () => void;
}) {
  const state = useTransferPick("LiquidFuel");
  const seeded: TransferPickState = seed
    ? { ...state, pick: { ...state.pick, ...seed } }
    : state;
  return (
    <ResourceTransferPicker
      transfer={transfer}
      state={seeded}
      form="list"
      onStarted={onStarted}
    />
  );
}

describe("ResourceTransferPicker", () => {
  it("sends the picked tanks until full by default", async () => {
    const user = userEvent.setup();
    const { transfer, start } = model();
    render(<Harness transfer={transfer} />);

    await user.click(
      within(screen.getByRole("group", { name: "Drop tank" })).getByRole(
        "button",
        { name: "From" },
      ),
    );
    await user.click(
      within(screen.getByRole("group", { name: "Radial" })).getByRole(
        "button",
        { name: "To" },
      ),
    );
    await user.click(screen.getByRole("button", { name: /Transfer/ }));

    expect(start.sent[0].args).toEqual({
      resource: "LiquidFuel",
      fromPartIds: ["1"],
      toPartIds: ["2"],
      untilFull: true,
      amount: undefined,
    });
  });

  it("sends nothing until there is a tank on each side", async () => {
    const user = userEvent.setup();
    const { transfer, start } = model();
    render(<Harness transfer={transfer} />);
    await user.click(screen.getByRole("button", { name: /Transfer/ }));
    expect(start.sent).toEqual([]);
  });

  it("refuses a blocked choice and says why to a screen reader", async () => {
    const user = userEvent.setup();
    const { transfer } = model();
    render(<Harness transfer={transfer} />);
    const to = within(screen.getByRole("group", { name: "Lander" })).getByRole(
      "button",
      { name: "To" },
    );

    await user.click(to);

    expect(to).toHaveAttribute("aria-pressed", "false");
    expect(to).toHaveAttribute("aria-disabled", "true");
  });

  it("shows a locked badge and a direction tag", () => {
    const { transfer } = model();
    render(<Harness transfer={transfer} />);
    expect(screen.getByText("Locked")).toBeInTheDocument();
    expect(screen.getAllByText("out only").length).toBeGreaterThan(0);
  });

  it("reports when the picked transfer is running", async () => {
    let started = 0;
    const job = {
      resource: "LiquidFuel",
      fromPartIds: ["1"],
      toPartIds: ["2"],
    } as ResourceTransferJob;
    const { transfer } = model({ running: [job] });
    render(
      <Harness
        transfer={transfer}
        seed={{ from: ["1"], to: ["2"] }}
        onStarted={() => started++}
      />,
    );
    await waitFor(() => expect(started).toBe(1));
  });

  it("has no accessibility violations", async () => {
    const { transfer } = model();
    const { container } = render(<Harness transfer={transfer} />);
    await expectNoA11yViolations(container);
  });
});

describe("ResourceFlowRow", () => {
  const job: ResourceTransferJob = {
    id: "t1",
    resource: "LiquidFuel",
    fromPartIds: ["1"],
    toPartIds: ["2"],
    untilFull: true,
    startedUt: value("ut", 1),
    moved: value("units", 64.2),
    rate: value("units/s", 18),
    state: TransferJobState.Running,
  };

  it("shows the route, the figures and stops that transfer", async () => {
    const user = userEvent.setup();
    const { transfer, stop } = model();
    const { container } = render(
      <ResourceFlowRow job={job} transfer={transfer} />,
    );

    expect(container).toHaveTextContent("Drop tank → Radial");
    expect(container).toHaveTextContent("64.2");
    expect(container).toHaveTextContent("until full");
    await user.click(screen.getByRole("button", { name: /Stop/ }));
    expect(stop.sent[0].args).toEqual({ all: false, transferId: "t1" });
  });

  it("marks a held list", () => {
    const { transfer } = model({ held: true });
    render(<ResourceFlowRow job={job} transfer={transfer} />);
    expect(screen.getByText("held")).toBeInTheDocument();
  });
});
