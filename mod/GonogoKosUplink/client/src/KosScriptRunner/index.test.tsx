import {
  clearRegistry,
  DashboardItemContext,
  type DataSource,
  registerDataSource,
} from "@ksp-gonogo/core";
import { render as rtlRender, screen, waitFor } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { axe } from "../test/axe";
import { KosScriptRunnerComponent } from "./index";

// Rendered trees, tracked so afterEach can unmount them BEFORE clearing the
// registry. RTL auto-cleanup runs after this file's afterEach, so it can't be
// relied on to unmount first — clearing the registry while the widget is still
// mounted fires a state update outside act(), the documented anti-pattern in
// CLAUDE.md.
const renderedTrees: Array<() => void> = [];

// The widget declares `actions`, so useActionInput needs a dashboard item id.
function render(ui: ReactElement) {
  const result = rtlRender(
    <DashboardItemContext.Provider value={{ instanceId: "kos-script-runner" }}>
      {ui}
    </DashboardItemContext.Provider>,
  );
  renderedTrees.push(result.unmount);
  return result;
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
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
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
    const user = userEvent.setup();
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

    await user.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].cpu).toBe("lander");
    expect(calls[0].script).toBe("0:/deploy.ks");
    expect(calls[0].args).toEqual(["5", "true"]);
  });

  it("surfaces a last-run acknowledgement after a successful dispatch", async () => {
    const user = userEvent.setup();
    registerFakeKos();
    render(
      <KosScriptRunnerComponent
        config={{ cpu: "lander", scriptName: "0:/deploy.ks" }}
      />,
    );

    expect(screen.getByText(/Press Run to dispatch/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /run/i }));

    await waitFor(() =>
      expect(screen.getByText(/Last run acknowledged/i)).toBeInTheDocument(),
    );
  });

  it("renders the returned payload when the script emits data", async () => {
    const user = userEvent.setup();
    registerFakeKos({ deployed: true, panels: 4 });
    render(
      <KosScriptRunnerComponent
        config={{ cpu: "lander", scriptName: "0:/deploy.ks" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /run/i }));

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
