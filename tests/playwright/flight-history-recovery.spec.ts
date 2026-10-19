/**
 * A flight that ends in a recovery is stored and listed in Flight history,
 * whether the craft was in contact when it was recovered or the mod held the
 * flight's end until a link returned and released it at the Space Center.
 */
import { expect, test } from "@playwright/test";
import { bootMissionControl } from "./mission-control";

const CASES = [
  {
    name: "recovered while in contact",
    fixture: "tests/fixtures/wire/recovery-connected.jsonl",
    vessel: "LFV-2 Wave Probe",
  },
  {
    name: "recovered out of contact, the end released at the Space Center",
    fixture: "tests/fixtures/wire/recovery-held-then-released.jsonl",
    vessel: "LFV-2 Wave Aerocam Probe",
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
