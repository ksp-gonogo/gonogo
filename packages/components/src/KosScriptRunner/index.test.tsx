import {
  clearRegistry,
  DashboardItemContext,
  type DataSource,
  registerDataSource,
} from "@gonogo/core";
import {
  cleanup,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { KosScriptRunnerComponent } from "./index";

// The widget declares `actions`, so useActionInput needs a dashboard item id.
function render(ui: ReactElement) {
  return rtlRender(
    <DashboardItemContext.Provider value={{ instanceId: "kos-script-runner" }}>
      {ui}
    </DashboardItemContext.Provider>,
  );
}

interface ExecCall {
  cpu: string;
  script: string;
  args: unknown[];
}

/**
 * Fake `kos` source that duck-types the `executeScript` RPC surface
 * `useKosWidget` reads — the same minimal shape used by useKosWidget's own
 * tests. Records each dispatch so we can assert the RUNPATH lands with the
 * right CPU / script / args.
 */
function registerFakeKos(result: Record<string, unknown> = {}) {
  const calls: ExecCall[] = [];
  const fake = {
    id: "kos",
    name: "Fake kOS",
    status: "connected" as const,
    affectedBySignalLoss: false,
    connect: async () => {},
    disconnect: () => {},
    schema: () => [],
    subscribe: () => () => {},
    onStatusChange: () => () => {},
    execute: async () => {},
    configSchema: () => [],
    configure: () => {},
    getConfig: () => ({}),
    executeScript: (cpu: string, script: string, args: unknown[]) => {
      calls.push({ cpu, script, args });
      return Promise.resolve(result);
    },
  };
  registerDataSource(fake as unknown as DataSource);
  return { calls };
}

describe("KosScriptRunnerComponent", () => {
  beforeEach(() => {
    clearRegistry();
  });
  afterEach(() => {
    cleanup();
    clearRegistry();
  });

  it("shows the configure prompt until a CPU and script are set", () => {
    registerFakeKos();
    render(<KosScriptRunnerComponent config={{}} />);
    expect(
      screen.getByText(/Set a target CPU and a script path/i),
    ).toBeInTheDocument();
  });

  it("dispatches RUNPATH with the configured CPU, script and args on Run", async () => {
    const { calls } = registerFakeKos();
    render(
      <KosScriptRunnerComponent
        config={{
          cpu: "lander",
          scriptName: "0:/deploy.ks",
          argsText: "5\ntrue",
        }}
      />,
    );

    screen.getByRole("button", { name: /run/i }).click();

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].cpu).toBe("lander");
    expect(calls[0].script).toBe("0:/deploy.ks");
    expect(calls[0].args).toEqual(["5", "true"]);
  });

  it("surfaces a last-run acknowledgement after a successful dispatch", async () => {
    registerFakeKos();
    render(
      <KosScriptRunnerComponent
        config={{ cpu: "lander", scriptName: "0:/deploy.ks" }}
      />,
    );

    expect(screen.getByText(/Press Run to dispatch/i)).toBeInTheDocument();
    screen.getByRole("button", { name: /run/i }).click();

    await waitFor(() =>
      expect(screen.getByText(/Last run acknowledged/i)).toBeInTheDocument(),
    );
  });

  it("renders the returned payload when the script emits data", async () => {
    registerFakeKos({ deployed: true, panels: 4 });
    render(
      <KosScriptRunnerComponent
        config={{ cpu: "lander", scriptName: "0:/deploy.ks" }}
      />,
    );

    screen.getByRole("button", { name: /run/i }).click();

    await waitFor(() =>
      expect(screen.getByText(/"panels": 4/)).toBeInTheDocument(),
    );
  });

  it("has no accessible violations", async () => {
    registerFakeKos();
    const { container } = render(
      <KosScriptRunnerComponent
        config={{ cpu: "lander", scriptName: "0:/deploy.ks" }}
      />,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
