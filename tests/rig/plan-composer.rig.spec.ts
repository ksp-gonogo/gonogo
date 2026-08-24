import { expect, type Page, test } from "@playwright/test";

/**
 * Composing a flight plan at the command centre and sending it to a REAL game.
 *
 * <p>This is the journey that was driven by hand on 2026-08-24 and found three
 * faults stacked behind each other: `Value`s on the wire where the receiving
 * side binds doubles, a refusal that rendered as an empty box so none of it was
 * visible, and three Δv fields labelled by the wrong basis. Written down as a
 * spec so the next person watches it back rather than re-deriving it.</p>
 *
 * <p><b>It asserts against the game, not the widget.</b> A widget that says it
 * sent a plan and a craft that holds one are different claims, and it was
 * exactly that gap the hand-driven run kept falling into: the status line read
 * the same whether the plan had landed or the uplink had been latched
 * unavailable twenty minutes earlier.</p>
 */
const RIG_HOST = process.env.RIG_HOST ?? "192.168.86.33";
const SITREP = `ws://${RIG_HOST}:${process.env.RIG_SITREP_PORT ?? "8090"}`;

/** The craft's flight plan, read straight off the stream. */
async function planFromGame(): Promise<{
  planExists?: boolean;
  burns?: Array<Record<string, number>>;
}> {
  const { WebSocket } = await import("ws");
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SITREP);
    const done = setTimeout(() => {
      ws.close();
      reject(new Error("no principia.plan sample arrived"));
    }, 30_000);
    ws.on("open", () =>
      ws.send(JSON.stringify({ type: "subscribe", topic: "principia.plan" })),
    );
    ws.on("message", (raw: Buffer) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type !== "stream-data" || msg.topic !== "principia.plan") return;
      clearTimeout(done);
      ws.close();
      resolve(msg.payload ?? msg.data);
    });
    ws.on("error", reject);
  });
}

async function press(page: Page, label: string) {
  await page.getByRole("button", { name: label }).first().click();
}

test("a plan composed here reaches the craft", async ({ page }) => {
  await page.goto("/");

  // The composer is an augment inside the maneuver planner, so the planner has
  // to be on the dashboard before any of it exists.
  await page.getByRole("button", { name: "Add component" }).click();
  await page.getByRole("option", { name: /^Maneuver Planner/ }).click();

  await expect(page.getByText("Uplinked plans")).toBeVisible();
  await press(page, "Draft plan");
  await press(page, "Add burn");

  // Ahead of the craft and inside the plan's window. A burn behind the craft is
  // refused by the producer, and that refusal reads like a struct fault.
  const ignitionUt = 425600;
  await page
    .getByRole("spinbutton", { name: "Ignition" })
    .fill(String(ignitionUt));
  // The TANGENT slot: in a TangentNormalBinormal burn the three positional
  // slots carry the basis's own components in its own order.
  await page.getByRole("spinbutton", { name: "Tangent" }).fill("65");

  await press(page, "Uplink to craft");
  await expect(
    page.getByText("Aboard. The craft is flying this plan."),
  ).toBeVisible();

  // The claim that matters. The widget saying so is not the craft holding one.
  const plan = await planFromGame();
  expect(plan.planExists).toBe(true);
  expect(plan.burns).toHaveLength(1);
  expect(plan.burns?.[0].ignitionUt).toBeCloseTo(ignitionUt, 0);
  expect(plan.burns?.[0].deltaVTangent).toBeCloseTo(65, 3);
  // Cartesian TNB. A built burn that left this at a fresh struct's zero carries
  // a value outside the producer's enum and aborts the game.
  expect(plan.burns?.[0].coordinateSystem).toBe(1);
});
