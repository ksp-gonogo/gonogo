import { act, render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  type AlarmCreateRequest,
  AlarmsLauncherProvider,
} from "../shared/AlarmsLauncher";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ContractManagerComponent } from "./index";

/** The bell beside each open objective, rendered with a real alarm pipeline in context. */

const SAFE_ID = "4242";
const UNSAFE_ID = "18834021456123789";

function mount(alarmSet: boolean) {
  const fixture = setupStreamFixture({
    pinnedUt: 0,
    suspendFrames: true,
  });
  const created: AlarmCreateRequest<unknown>[] = [];
  const removed: string[] = [];
  const view = render(
    <fixture.Provider>
      <AlarmsLauncherProvider
        launcher={() => {}}
        creator={(req) => created.push(req)}
        manager={{
          find: (matcher) =>
            alarmSet &&
            matcher({
              kind: "contract-parameter",
              contractId: Number(SAFE_ID),
              parameterTitle: "Orbit Kerbin",
            })
              ? "alarm-1"
              : null,
          remove: (id) => removed.push(id),
        }}
      >
        <ContractManagerComponent config={{}} id="bell" />
      </AlarmsLauncherProvider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("career.status", {
      contracts: {
        active: [
          {
            id: SAFE_ID,
            title: "Orbit the homeworld",
            state: "Active",
            parameters: [
              { title: "Orbit Kerbin", state: "Incomplete", stateOrdinal: 0 },
              { title: "Return home", state: "Complete", stateOrdinal: 1 },
            ],
          },
          {
            id: UNSAFE_ID,
            title: "Rescue a kerbal",
            state: "Active",
            parameters: [
              {
                title: "Board the craft",
                state: "Incomplete",
                stateOrdinal: 0,
              },
            ],
          },
        ],
        offered: [],
        completedRecent: [],
      },
    });
  });
  return { view, created, removed };
}

describe("ContractManager: the objective alarm bell", () => {
  it("offers a bell on an open objective and creates a completion alarm for it", async () => {
    const { created } = mount(false);
    const bell = screen.getByRole("button", {
      name: "Set alarm for Orbit Kerbin completion",
    });
    expect(bell.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(bell);
    expect(created).toEqual([
      {
        name: "Orbit Kerbin → Complete",
        trigger: {
          kind: "contract-parameter",
          contractId: 4242,
          parameterTitle: "Orbit Kerbin",
          targetState: "Complete",
          sustainSeconds: 0,
        },
      },
    ]);
  });

  it("offers no bell on a completed objective", () => {
    mount(false);
    expect(screen.queryByRole("button", { name: /Return home/ })).toBeNull();
  });

  it("clears an alarm already set rather than creating a second", async () => {
    const { created, removed } = mount(true);
    const bell = screen.getByRole("button", {
      name: "Clear alarm for Orbit Kerbin",
    });
    expect(bell.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(bell);
    expect(removed).toEqual(["alarm-1"]);
    expect(created).toEqual([]);
  });

  it("disables the bell on a contract whose id cannot fit the trigger", async () => {
    const { view } = mount(false);
    const bell = screen.getByRole("button", {
      name: "Alarm unavailable for this contract",
    });
    expect((bell as HTMLButtonElement).disabled).toBe(true);
    await expectNoA11yViolations(view.container);
  });
});
