import { render, screen } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { UplinkLoadOutcome } from "../uplinks/loaderState";
import type { LocalUplinkStatus } from "../uplinks/localUplinks";
import { LocalBuilds, localStatusLine } from "./LocalBuilds";
import { type UplinkPage, UplinksSettings } from "./UplinksSettings";

const status = (over: Partial<LocalUplinkStatus> = {}): LocalUplinkStatus => ({
  id: "alpha",
  name: "Alpha",
  path: "/work/gonogo-uplinks/uplinks/alpha",
  state: "built",
  error: null,
  builtAt: "2026-10-06T14:02:11.000Z",
  version: "0.9.3-dev",
  apiVersion: "6.0.0",
  uiKitVersion: "0.1.0",
  ...over,
});

const page = (
  over: Partial<UplinkPage> = {},
  local: Partial<LocalUplinkStatus> = {},
  client?: Partial<UplinkLoadOutcome>,
): UplinkPage => ({
  id: "alpha",
  name: "Alpha",
  gonogo: false,
  undeclared: false,
  modSettings: false,
  rosterKnown: true,
  attention: false,
  rows: [],
  panels: [],
  local: status(local),
  client: client && { id: "alpha", name: "Alpha", status: "loaded", ...client },
  ...over,
});

describe("the status line of a build named with --uplink", () => {
  it("says loaded, with the mod reporting it", () => {
    const line = localStatusLine(
      page(
        { health: { version: "0.9.3" } as UplinkPage["health"] },
        {},
        {
          status: "loaded",
        },
      ),
    );
    expect(line).toBe("Client: loaded · mod: reporting, v0.9.3");
  });

  it("says why a client was quarantined", () => {
    const line = localStatusLine(
      page(
        {},
        {},
        { status: "quarantined", reason: "apiVersion major mismatch" },
      ),
    );
    expect(line).toContain("quarantined: apiVersion major mismatch");
  });

  it("says it is waiting for the first build, and what to run", () => {
    const line = localStatusLine(page({}, { state: "waiting", builtAt: null }));
    expect(line).toContain("waiting for the first build");
    expect(line).toContain("watch build");
  });

  it("says a build failed with the first error line, and that the last good build is loaded", () => {
    const line = localStatusLine(
      page(
        {},
        { state: "failed", error: 'Unexpected ";"' },
        { status: "loaded" },
      ),
    );
    expect(line).toContain('build failed: Unexpected ";"');
    expect(line).toContain("the last good build is loaded");
  });

  it("says the mod is not reporting an Uplink it does not list", () => {
    expect(localStatusLine(page({}, {}, { status: "loaded" }))).toContain(
      "mod: not reporting alpha",
    );
  });
});

describe("Local builds", () => {
  it("lists each build with its badge, facts and status, and reloads on request", async () => {
    const reload = vi.fn();
    const { container } = render(
      <LocalBuilds
        pages={[
          page({}, {}, { status: "loaded" }),
          page(
            { id: "beta", name: "Beta" },
            {
              id: "beta",
              name: "Beta",
              path: "/work/gonogo-uplinks/uplinks/beta",
              state: "waiting",
              builtAt: null,
              version: null,
            },
          ),
        ]}
        reload={reload}
      />,
    );

    expect(screen.getAllByText("Local")).toHaveLength(2);
    expect(screen.getByText(/v0\.9\.3-dev/)).toBeInTheDocument();
    expect(
      screen.getByText(/\/work\/gonogo-uplinks\/uplinks\/alpha/),
    ).toBeInTheDocument();
    expect(screen.getByText(/waiting for the first build/)).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole("button", { name: "Reload" })[0]);
    expect(reload).toHaveBeenCalledOnce();

    await expectNoA11yViolations(container);
  });

  it("leads the Uplinks tabs, and marks each local Uplink's own tab", () => {
    render(<UplinksSettings pages={[page({}, {}, { status: "loaded" })]} />);
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs[0]).toContain("Local builds");
    expect(tabs[1]).toContain("Alpha (local)");
  });

  it("adds no group when nothing was named with --uplink", () => {
    render(
      <UplinksSettings
        pages={[page({ local: undefined }, {}, { status: "loaded" })]}
      />,
    );
    expect(screen.queryByText("Local builds")).not.toBeInTheDocument();
  });
});
