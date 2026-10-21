/**
 * A flight that ends in a recovery is stored and listed in Flight history,
 * whether the craft was in contact when it was recovered or out of contact
 * after a blackout: a recovery is news from the ground, so the flight's end
 * reaches every screen at once either way.
 */
import { expect, test } from "@playwright/test";
import { bootMissionControl } from "./mission-control";

const CASES = [
  {
    name: "recovered while in contact",
    fixture: "tests/fixtures/wire/recovery-connected.jsonl",
    vessel: "LFV-2 Wave",
  },
  {
    name: "recovered out of contact",
    fixture: "tests/fixtures/wire/recovery-held-then-released.jsonl",
    vessel: "LFV-2 Wave",
  },
];

for (const { name, fixture, vessel } of CASES) {
  test(`a flight ${name} is listed in Flight history`, async ({ browser }) => {
    const mc = await bootMissionControl(browser, {
      fixture,
      stations: 0,
      widgets: [{ componentId: "semi-major-axis" }],
    });
    const { durationMs } = await mc.replay.state();
    for (let ms = 0; ms < durationMs; ms += 5_000) {
      await mc.replay.advanceTo(ms);
    }
    await mc.replay.advanceTo(durationMs);

    await mc.main.getByRole("button", { name: "Dashboard controls" }).click();
    await mc.main.getByRole("button", { name: "Flight history" }).click();
    const dialog = mc.main.getByRole("dialog", { name: "Flight History" });
    await expect(
      dialog.getByRole("checkbox", { name: `Select flight ${vessel}` }),
    ).toBeVisible({ timeout: 15_000 });
    await mc.close();
  });
}
