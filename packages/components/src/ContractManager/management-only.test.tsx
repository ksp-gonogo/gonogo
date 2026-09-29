import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { AlarmsLauncherProvider } from "../shared/AlarmsLauncher";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ContractManagerComponent } from "./index";

/**
 * Contract Manager manages contracts; live objective progress and its alarms
 * belong to Objectives alone, so nothing alarm-shaped may be imported or drawn
 * here.
 */

const ALARM_SHAPED = /alarm|bell/i;
const IMPORT = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g;

function sourceFiles(): string[] {
  return readdirSync(import.meta.dirname).filter(
    (f) => /\.tsx?$/.test(f) && !/\.test(-d)?\.tsx?$/.test(f),
  );
}

describe("Contract Manager is management only", () => {
  it("imports nothing alarm-shaped", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const text = readFileSync(join(import.meta.dirname, file), "utf8");
      for (const [, names, from] of text.matchAll(IMPORT)) {
        if (ALARM_SHAPED.test(names ?? "") || ALARM_SHAPED.test(from ?? "")) {
          offenders.push(`${file}: import ${names} from "${from}"`);
        }
      }
    }
    expect(sourceFiles().length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it("draws no alarm control on an open objective, even with alarms available", () => {
    const fixture = setupStreamFixture({ pinnedUt: 0, suspendFrames: true });
    render(
      <fixture.Provider>
        <AlarmsLauncherProvider
          launcher={() => {}}
          creator={() => {}}
          manager={{ find: () => null, remove: () => {} }}
        >
          <ContractManagerComponent config={{}} id="cm" />
        </AlarmsLauncherProvider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("career.status", {
        contracts: {
          active: [
            {
              id: "4242",
              title: "Orbit the homeworld",
              state: "Active",
              parameters: [
                { title: "Orbit Kerbin", state: "Incomplete", stateOrdinal: 0 },
              ],
            },
          ],
          offered: [],
          completedRecent: [],
        },
      });
    });
    expect(screen.getByText("Orbit Kerbin")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ALARM_SHAPED })).toBeNull();
  });
});
