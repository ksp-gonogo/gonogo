import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import {
  expectNoA11yViolations,
  visibleText,
} from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import heardAtHome from "./__fixtures__/heard-at-home.json";
import heardAtMunStation from "./__fixtures__/heard-at-mun-station.json";
import { ObjectivesComponent } from "./index";

afterEach(() => {
  clearActionHandlers();
});

interface Emit {
  channel: string;
  value: unknown;
  meta?: { vantage?: string };
}

async function renderScene(emits: readonly Emit[]) {
  const fixture = setupStreamFixture({ pinnedUt: 1000, suspendFrames: true });
  const view = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "obj-heard" }}>
        <ObjectivesComponent id="obj-heard" w={5} h={8} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  for (const e of emits) {
    await waitFor(() =>
      expect(fixture.transport.isSubscribed(e.channel)).toBe(true),
    );
    act(() => fixture.emit(e.channel, e.value, e.meta));
  }
  await waitFor(() => expect(visibleText()).toContain("Orbit the Mun"));
  return { fixture, ...view };
}

const withSettled = (emits: readonly Emit[], keys: string[]): Emit[] =>
  emits.map((e) =>
    e.channel === "career.status" &&
    typeof e.value === "object" &&
    e.value !== null
      ? {
          ...e,
          value: {
            ...e.value,
            objectivesSettled: keys.map((key) => ({
              key,
              outcome: "Applied",
              ut: 1112,
            })),
          },
        }
      : e,
  );

/** The row for one objective, by its title. */
function rowOf(container: HTMLElement, title: string): HTMLElement {
  const row = [...container.querySelectorAll("li")].find((li) =>
    li.textContent?.includes(title),
  );
  if (!row) throw new Error(`no row for ${title}`);
  return row;
}

const withNoRoute = (emits: readonly Emit[]): Emit[] =>
  emits.map((e) =>
    e.channel.startsWith("career.objectives.") &&
    typeof e.value === "object" &&
    e.value !== null
      ? { ...e, value: { ...e.value, homeArrivesUt: null } }
      : e,
  );

describe("Objectives: what a command centre away from home has heard", () => {
  it("shows an objective met when this centre has heard it met, with no line added", async () => {
    const { container } = await renderScene(heardAtMunStation._stream.emits);

    await waitFor(() =>
      expect(rowOf(container, "Orbit the Mun").textContent).toContain(
        "reached",
      ),
    );
    expect(rowOf(container, "Plant a flag on the Mun").textContent).toContain(
      "pending",
    );
    expect(rowOf(container, "Orbit the Mun").textContent).not.toContain(
      "complete",
    );
    await expectNoA11yViolations(container);
  });

  it("says a contract is complete, and when home hears, once a vessel has met every objective", async () => {
    const { container } = await renderScene(heardAtMunStation._stream.emits);

    await waitFor(() =>
      expect(visibleText()).toContain("complete, home hears in"),
    );
    expect(rowOf(container, "Land on the Mun").textContent).toContain(
      "Test the LV-909 on the Mun · complete, home hears in 2min 30s",
    );
    expect(
      rowOf(container, "Test LV-909: Landed on the Mun").textContent,
    ).not.toContain("complete");
  });

  it("says home cannot hear yet when a vessel the contract waits on has no route home", async () => {
    await renderScene(withNoRoute(heardAtMunStation._stream.emits));

    await waitFor(() =>
      expect(visibleText()).toContain("complete, home cannot hear yet"),
    );
  });

  it("shows home's state at the home command, which learns of a change only when it applies it", async () => {
    const emits = heardAtHome._stream.emits;
    const { container, fixture } = await renderScene(
      emits.filter((e) => !e.channel.startsWith("career.objectives.")),
    );

    for (const e of emits) {
      if (e.channel.startsWith("career.objectives.")) {
        expect(fixture.transport.isSubscribed(e.channel)).toBe(false);
      }
    }
    expect(rowOf(container, "Orbit the Mun").textContent).toContain("pending");
    expect(visibleText()).not.toContain("complete");
  });

  it("gives an objective back to home's state once home has acted on the change", async () => {
    const { container } = await renderScene(
      withSettled(heardAtMunStation._stream.emits.slice(0, 3), [
        "9101/0/Met@940",
      ]).concat(heardAtMunStation._stream.emits.slice(3)),
    );

    await waitFor(() =>
      expect(visibleText()).toContain("complete, home hears in"),
    );
    expect(rowOf(container, "Orbit the Mun").textContent).toContain("pending");
  });
});
