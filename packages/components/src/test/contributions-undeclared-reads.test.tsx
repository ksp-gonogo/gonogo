import {
  CORE_UPLINK_CLIENT,
  ContributionsProvider,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import { getViewUt, sampleActiveTopic } from "@ksp-gonogo/sitrep-client";
import { act, render } from "@ksp-gonogo/test-utils";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { setupStreamFixture } from "./setupStreamFixture";

/**
 * A contribution that reads what it did not declare keeps whatever that read
 * said at its last recompute, and it recomputes only when a declared input
 * moves. So the read has to be named as it happens, or it is found only when
 * something stops recomputing for it.
 */

CORE_UPLINK_CLIENT.registerContribution({
  id: "undeclared-probe-clock",
  contributes: "undeclared-probe-clock.badges",
  deps: ["comms.link"],
  compute: () => {
    getViewUt();
    return [];
  },
});

CORE_UPLINK_CLIENT.registerContribution({
  id: "undeclared-probe-topic",
  contributes: "undeclared-probe-topic.badges",
  deps: ["comms.link"],
  compute: () => {
    sampleActiveTopic("vessel.orbit");
    sampleActiveTopic("comms.link");
    return [];
  },
});

const READS_THE_CLOCK = CORE_UPLINK_CLIENT.registerProcessor({
  id: "undeclared-probe-processor",
  deps: ["comms.link"] as const,
  compute: (_values, { viewUt }) => {
    getViewUt();
    return viewUt > 0;
  },
});

CORE_UPLINK_CLIENT.registerContribution({
  id: "undeclared-probe-via-processor",
  contributes: "undeclared-probe-via-processor.badges",
  deps: [READS_THE_CLOCK],
  compute: () => [],
});

function mount(componentId: string) {
  const fixture = setupStreamFixture({
    carriedChannels: ["comms.link", "vessel.orbit"],
    pinnedUt: 10,
    suspendFrames: true,
  });
  const view = render(
    <fixture.Provider>
      <WidgetMetaContext.Provider
        value={{ componentId, contributionSlots: [] }}
      >
        <ContributionsProvider>{null}</ContributionsProvider>
      </WidgetMetaContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("comms.link", { connected: true });
    fixture.store.beginFrame();
  });
  return view.unmount;
}

let errors: MockInstance<typeof console.error>;
let unmount: (() => void) | undefined;
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  unmount?.();
  unmount = undefined;
  errors.mockRestore();
});

const reports = () =>
  errors.mock.calls
    .map(([m]) => String(m))
    .filter((m) => m.startsWith("contribution "));

describe("a contribution's undeclared reads are named", () => {
  it("names a contribution that reads the view clock", () => {
    unmount = mount("undeclared-probe-clock");
    expect(reports()).toEqual([
      "contribution core:undeclared-probe-clock read getViewUt without declaring it; move it into a processor",
    ]);
  });

  it("names the undeclared topic, and not the declared one", () => {
    unmount = mount("undeclared-probe-topic");
    expect(reports()).toEqual([
      'contribution core:undeclared-probe-topic read sampleActiveTopic("vessel.orbit") without declaring it; move it into a processor',
    ]);
  });

  it("says nothing about a processor's reads, which it re-runs every frame", () => {
    unmount = mount("undeclared-probe-via-processor");
    expect(reports()).toEqual([]);
  });
});
