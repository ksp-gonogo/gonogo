import {
  clearActionHandlers,
  DashboardItemContext,
  dispatchAction,
  PerfBudget,
} from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import type { NavballConfig } from "./config";
import { NavballComponent, sasModeOrdinal } from "./index";
import type { SasMode } from "./sasModes";

const PRESS = { kind: "button", value: true } as const;
const RELEASE = { kind: "button", value: false } as const;

beforeEach(() => {
  // Each mount registers ~30 actions, so back-to-back mounts would trip the register/sec budget.
  PerfBudget.getAll()
    .find((b) => b.name.startsWith("useActionInput register"))
    ?.reset();
});

afterEach(() => {
  clearActionHandlers();
});

function mount(
  instanceId: string,
  options: {
    config?: NavballConfig;
    onConfigChange?: (c: NavballConfig) => void;
  } = {},
) {
  const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
  const handler = vi.fn(() => ({ ok: true }));
  fixture.transport.setCommandHandler(handler);
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <NavballComponent
          config={options.config ?? {}}
          onConfigChange={options.onConfigChange}
          id={instanceId}
          w={10}
          h={20}
        />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  return { fixture, handler };
}

/** Several 10 Hz control-stream ticks, held inside act. */
async function letTheStreamTick(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 450));
  });
}

function dispatch(
  instanceId: string,
  action: string,
  payload: Parameters<typeof dispatchAction>[2],
) {
  let result: unknown = "unset";
  act(() => {
    result = dispatchAction(instanceId, action, payload);
  });
  return result;
}

describe("Navball take-control", () => {
  it("flips control mode on and then off through onConfigChange", () => {
    const onConfigChange = vi.fn();
    mount("nav-act-take", { config: { controlMode: false }, onConfigChange });

    dispatch("nav-act-take", "take-control", PRESS);

    expect(onConfigChange).toHaveBeenCalledWith({ controlMode: true });
  });

  it("flips control mode off when it is already on", () => {
    const onConfigChange = vi.fn();
    mount("nav-act-take-off", {
      config: { controlMode: true },
      onConfigChange,
    });

    dispatch("nav-act-take-off", "take-control", PRESS);

    expect(onConfigChange).toHaveBeenCalledWith({ controlMode: false });
  });

  it("ignores the release of the button", () => {
    const onConfigChange = vi.fn();
    mount("nav-act-take-rel", { onConfigChange });

    const result = dispatch("nav-act-take-rel", "take-control", RELEASE);

    expect(result).toBeUndefined();
    expect(onConfigChange).not.toHaveBeenCalled();
  });
});

describe("Navball toggle-precision", () => {
  it("sends nothing on a press, since precision control has no set command", async () => {
    const { handler } = mount("nav-act-precision");

    dispatch("nav-act-precision", "toggle-precision", PRESS);
    await letTheStreamTick();

    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores the release of the button", async () => {
    const { handler } = mount("nav-act-precision-rel");

    const result = dispatch(
      "nav-act-precision-rel",
      "toggle-precision",
      RELEASE,
    );
    await letTheStreamTick();

    expect(result).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("Navball SAS mode actions", () => {
  const MODE_ACTIONS: ReadonlyArray<readonly [string, SasMode]> = [
    ["sas-stability", "StabilityAssist"],
    ["sas-prograde", "Prograde"],
    ["sas-retrograde", "Retrograde"],
    ["sas-normal", "Normal"],
    ["sas-antinormal", "Antinormal"],
    ["sas-radial-in", "RadialIn"],
    ["sas-radial-out", "RadialOut"],
    ["sas-target", "Target"],
    ["sas-anti-target", "AntiTarget"],
    ["sas-maneuver", "Maneuver"],
  ];

  it.each(
    MODE_ACTIONS,
  )("%s sends vessel.control.setSasMode for %s", async (action, mode) => {
    const id = `nav-act-${action}`;
    const { handler } = mount(id);

    dispatch(id, action, PRESS);

    await waitFor(() =>
      expect(handler).toHaveBeenCalledWith("vessel.control.setSasMode", {
        mode: sasModeOrdinal(mode),
      }),
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it.each(
    MODE_ACTIONS,
  )("%s ignores the release of the button", async (action) => {
    const id = `nav-act-rel-${action}`;
    const { handler } = mount(id);

    dispatch(id, action, RELEASE);
    await letTheStreamTick();

    expect(handler).not.toHaveBeenCalled();
  });
});

describe("Navball throttle step actions", () => {
  const THROTTLE = "vessel.control.setThrottle";

  async function mountAtThrottle(id: string, throttle: number) {
    const mounted = mount(id);
    act(() => {
      mounted.fixture.emit("vessel.control", { throttle });
    });
    return mounted;
  }

  it("throttle-down steps 10% below the confirmed throttle", async () => {
    const { handler } = await mountAtThrottle("nav-act-thr-down", 0.5);

    dispatch("nav-act-thr-down", "throttle-down", PRESS);

    await waitFor(() =>
      expect(handler).toHaveBeenCalledWith(THROTTLE, { value: 0.4 }),
    );
  });

  it("throttle-down never goes below zero", async () => {
    const { handler } = await mountAtThrottle("nav-act-thr-floor", 0.05);

    dispatch("nav-act-thr-floor", "throttle-down", PRESS);

    await waitFor(() =>
      expect(handler).toHaveBeenCalledWith(THROTTLE, { value: 0 }),
    );
  });

  it("throttle-down refuses a step while the throttle has neither a reading nor a command", async () => {
    const { handler } = mount("nav-act-thr-down-blind");

    dispatch("nav-act-thr-down-blind", "throttle-down", PRESS);
    await letTheStreamTick();

    expect(handler).not.toHaveBeenCalled();
  });

  it("throttle-down ignores the release of the button", async () => {
    const { handler } = await mountAtThrottle("nav-act-thr-down-rel", 0.5);

    dispatch("nav-act-thr-down-rel", "throttle-down", RELEASE);
    await letTheStreamTick();

    expect(handler).not.toHaveBeenCalled();
  });

  it("throttle-up never goes above one", async () => {
    const { handler } = await mountAtThrottle("nav-act-thr-ceiling", 0.95);

    dispatch("nav-act-thr-ceiling", "throttle-up", PRESS);

    await waitFor(() =>
      expect(handler).toHaveBeenCalledWith(THROTTLE, { value: 1 }),
    );
  });

  it("throttle-up ignores the release of the button", async () => {
    const { handler } = await mountAtThrottle("nav-act-thr-up-rel", 0.5);

    dispatch("nav-act-thr-up-rel", "throttle-up", RELEASE);
    await letTheStreamTick();

    expect(handler).not.toHaveBeenCalled();
  });
});

describe("Navball throttle preset actions", () => {
  const THROTTLE = "vessel.control.setThrottle";

  it("throttle-zero commands a zero throttle even with no reading", async () => {
    const { handler } = mount("nav-act-thr-zero");

    dispatch("nav-act-thr-zero", "throttle-zero", PRESS);

    await waitFor(() =>
      expect(handler).toHaveBeenCalledWith(THROTTLE, { value: 0 }),
    );
  });

  it("throttle-full commands a full throttle", async () => {
    const { handler } = mount("nav-act-thr-full");

    dispatch("nav-act-thr-full", "throttle-full", PRESS);

    await waitFor(() =>
      expect(handler).toHaveBeenCalledWith(THROTTLE, { value: 1 }),
    );
  });

  it.each([
    "throttle-zero",
    "throttle-full",
  ])("%s ignores the release of the button", async (action) => {
    const id = `nav-act-rel-${action}`;
    const { handler } = mount(id);

    dispatch(id, action, RELEASE);
    await letTheStreamTick();

    expect(handler).not.toHaveBeenCalled();
  });
});

describe("Navball analog axis actions", () => {
  const SET_AXES = "vessel.control.setAxes";
  const AXES = [
    ["set-pitch", "pitch"],
    ["set-yaw", "yaw"],
    ["set-roll", "roll"],
    ["translate-x", "x"],
    ["translate-y", "y"],
    ["translate-z", "z"],
  ] as const;

  it.each(
    AXES,
  )("%s drives its own setAxes field (%s)", async (action, field) => {
    const id = `nav-act-axis-${action}`;
    const { handler } = mount(id);

    dispatch(id, action, { kind: "analog", value: 0.5 });

    await waitFor(() =>
      expect(handler).toHaveBeenCalledWith(SET_AXES, { [field]: 0.5 }),
    );
  });

  it.each(
    AXES,
  )("%s clamps a deflection past full travel to the axis range", async (action, field) => {
    const id = `nav-act-axis-clamp-${action}`;
    const { handler } = mount(id);

    dispatch(id, action, { kind: "analog", value: -3 });

    await waitFor(() =>
      expect(handler).toHaveBeenCalledWith(SET_AXES, { [field]: -1 }),
    );
  });

  it.each(AXES)("%s treats a NaN deflection as no command", async (action) => {
    const id = `nav-act-axis-nan-${action}`;
    const { handler } = mount(id);

    dispatch(id, action, { kind: "analog", value: Number.NaN });
    await letTheStreamTick();

    expect(handler).not.toHaveBeenCalled();
  });

  it.each(AXES)("%s ignores a button payload", async (action) => {
    const id = `nav-act-axis-button-${action}`;
    const { handler } = mount(id);

    dispatch(id, action, PRESS);
    await letTheStreamTick();

    expect(handler).not.toHaveBeenCalled();
  });
});

describe("Navball trim actions", () => {
  it.each([
    "set-pitch-trim",
    "set-yaw-trim",
    "set-roll-trim",
  ])("%s ignores a button payload", async (action) => {
    const id = `nav-act-trim-button-${action}`;
    const { handler } = mount(id);

    dispatch(id, action, PRESS);
    await letTheStreamTick();

    expect(handler).not.toHaveBeenCalled();
  });
});

describe("Navball toggle and kill actions", () => {
  it.each([
    "toggle-sas",
    "toggle-rcs",
    "kill-rotation",
    "arm-fbw",
    "disarm-fbw",
  ])("%s ignores the release of the button", async (action) => {
    const id = `nav-act-rel-${action}`;
    const { fixture, handler } = mount(id);
    // A confirmed state, so a stray press would have something to toggle.
    act(() => {
      fixture.emit("vessel.control", { sas: true, rcs: false, throttle: 0 });
    });

    const result = dispatch(id, action, RELEASE);
    await letTheStreamTick();

    expect(result).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });
});
