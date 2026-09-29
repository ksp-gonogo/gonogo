import { expect, test } from "@playwright/test";
import { PORTS } from "../../playwright.config";
import {
  addToGroup,
  CHUNK_MS,
  clipSeconds,
  closeAll,
  FAR,
  FAR_SECONDS,
  keyDown,
  keyUp,
  NAMES,
  NEAR,
  NEAR_SECONDS,
  openConversation,
  openScreen,
  publishScene,
  reception,
  type Screen,
  sendMessage,
  speak,
  waitForReception,
} from "./commcast-radio-scene";
import { getHostPeerId } from "./helpers";

/**
 * Messages and radio go to a GROUP, and only its members hear them.
 *
 * Three real screens talking through the mod: mission control at `ksc`, a
 * craft 3 s out and a craft 9 s out. What these show is that a screen outside
 * the group keeps, plays and lights nothing of it, and that a member added
 * while somebody is talking hears the change and then the stream from where it
 * had got to, each one light-time from mission control.
 */

test.use({ video: "off", trace: "off" });
test.describe.configure({ timeout: 240_000 });

/** Chromium only, for the peer-link reason `commcast-radio.spec.ts` records. */
test.describe("commcast groups: delivery only to members @chromium-only", () => {
  test("a group's message and transmission reach its member and nobody outside it", async ({
    browser,
  }, testInfo) => {
    const CHUNKS = 100;
    await publishScene([
      PORTS.radioStream.ksc,
      PORTS.radioStream.near,
      PORTS.radioStream.far,
    ]);
    const videoDir = testInfo.outputPath("videos");
    const control = await openScreen(browser, {
      name: "mission-control",
      url: "/?uplinkLoaderIds=",
      dashboardKey: "gonogo:dashboard:main",
      sitrepPort: PORTS.radioStream.ksc,
      videoDir,
      clip: { name: "ground to the near craft", chunks: CHUNKS },
    });
    const shareCode = await getHostPeerId(control.page);
    const near = await openScreen(browser, {
      name: "near-craft",
      url: `/pilot?host=${shareCode}&uplinkLoaderIds=`,
      dashboardKey: "gonogo:dashboard:main",
      sitrepPort: PORTS.radioStream.near,
      videoDir,
      clip: { name: "near craft", chunks: 10 },
      host: control.page,
    });
    const far = await openScreen(browser, {
      name: "far-craft",
      url: `/pilot?host=${shareCode}&uplinkLoaderIds=`,
      dashboardKey: "gonogo:dashboard:main",
      sitrepPort: PORTS.radioStream.far,
      videoDir,
      clip: { name: "far craft", chunks: 10 },
      host: control.page,
    });
    const screens: Screen[] = [control, near, far];

    try {
      await openConversation(control.page, NAMES[NEAR]);
      await sendMessage(control.page, "Near, Kennedy. Go for the burn.");
      await keyDown(control.page);
      await speak(control.page, CHUNKS);
      await control.page.waitForTimeout(clipSeconds(CHUNKS) * 1000 + 300);
      await keyUp(control.page);

      await waitForReception(near.page, (r) => r.decoded.length >= CHUNKS, {
        timeout: 30_000,
        message: "the member never heard the transmission",
      });
      await expect(
        near.page.getByText("Near, Kennedy. Go for the burn.").first(),
      ).toBeVisible({ timeout: 15_000 });

      // Long enough for anything addressed to the far craft to have crossed its nine seconds and played out.
      await far.page.waitForTimeout(
        FAR_SECONDS * 1000 + clipSeconds(CHUNKS) * 1000 + 2_000,
      );
      const farHeard = await reception(far.page);
      console.info(
        `[radio-groups] member decoded ${(await reception(near.page)).decoded.length} chunks, non-member ${farHeard.decoded.length}`,
      );
      expect(farHeard.decoded, "the non-member played nothing").toEqual([]);
      expect(farHeard.litAt, "the non-member's lamp never lit").toBeNull();
      await expect(
        far.page.getByText("Near, Kennedy. Go for the burn."),
      ).toHaveCount(0);
      await expect(far.page.getByText(/No conversations/)).toBeVisible();
    } finally {
      await closeAll(screens);
    }
  });

  test("a target added mid-transmission hears the join, then the stream from there, after its own light-time", async ({
    browser,
  }, testInfo) => {
    const CHUNKS = 750;
    const ADD_AFTER_MS = 4_000;
    await publishScene([
      PORTS.radioStream.ksc,
      PORTS.radioStream.near,
      PORTS.radioStream.far,
    ]);
    const videoDir = testInfo.outputPath("videos");
    const control = await openScreen(browser, {
      name: "mission-control",
      url: "/?uplinkLoaderIds=",
      dashboardKey: "gonogo:dashboard:main",
      sitrepPort: PORTS.radioStream.ksc,
      videoDir,
      clip: { name: "ground, then the far craft joins", chunks: CHUNKS },
    });
    const shareCode = await getHostPeerId(control.page);
    const near = await openScreen(browser, {
      name: "near-craft",
      url: `/pilot?host=${shareCode}&uplinkLoaderIds=`,
      dashboardKey: "gonogo:dashboard:main",
      sitrepPort: PORTS.radioStream.near,
      videoDir,
      clip: { name: "near craft", chunks: 10 },
      host: control.page,
    });
    const far = await openScreen(browser, {
      name: "far-craft",
      url: `/pilot?host=${shareCode}&uplinkLoaderIds=`,
      dashboardKey: "gonogo:dashboard:main",
      sitrepPort: PORTS.radioStream.far,
      videoDir,
      clip: { name: "far craft", chunks: 10 },
      host: control.page,
    });
    const screens: Screen[] = [control, near, far];

    try {
      await openConversation(control.page, NAMES[NEAR]);
      const keyedAt = await keyDown(control.page);
      await speak(control.page, CHUNKS);
      await control.page.waitForTimeout(ADD_AFTER_MS);

      const addedAt = await addToGroup(control.page, [NAMES[FAR]]);
      const join = far.page.getByText(`added ${NAMES[FAR]}`).first();

      // Nothing of the change, or of the voice, reaches the far craft before its nine seconds are up.
      await far.page.waitForTimeout(
        Math.max(0, addedAt + (FAR_SECONDS - 1.5) * 1000 - Date.now()),
      );
      await expect(join).toHaveCount(0);
      expect((await reception(far.page)).decoded).toEqual([]);

      await expect(join).toBeVisible({ timeout: 6_000 });
      const joinSeenAt = Date.now();
      await waitForReception(far.page, (r) => r.firstDecodeAt !== null, {
        timeout: 10_000,
        message: "the added target never heard the transmission",
      });

      await control.page.waitForTimeout(
        Math.max(0, keyedAt + clipSeconds(CHUNKS) * 1000 - Date.now()) + 300,
      );
      await keyUp(control.page);
      await far.page.waitForTimeout(FAR_SECONDS * 1000 + 2_000);

      const nearHeard = await reception(near.page);
      const farHeard = await reception(far.page);
      const firstIndex = farHeard.decoded[0] as number;
      const spokenAt = keyedAt + firstIndex * CHUNK_MS;
      const crossing = (farHeard.firstDecodeAt as number) - spokenAt;
      console.info(
        `[radio-groups] far added ${((addedAt - keyedAt) / 1000).toFixed(2)}s into the keying; join seen ${((joinSeenAt - addedAt) / 1000).toFixed(2)}s after the add; first heard chunk ${firstIndex}, spoken ${((spokenAt - addedAt) / 1000).toFixed(2)}s after the add, heard ${(crossing / 1000).toFixed(2)}s after it was spoken (separation ${FAR_SECONDS}s)`,
      );

      // The near craft was in the group from the start and heard all of it.
      expect(nearHeard.decoded).toEqual(
        Array.from({ length: CHUNKS }, (_, i) => i),
      );

      // The join reached the far craft one light-time after the add.
      expect(joinSeenAt - addedAt).toBeGreaterThan(FAR_SECONDS * 1000 - 1_500);
      expect(joinSeenAt - addedAt).toBeLessThan(FAR_SECONDS * 1000 + 2_500);

      // From the chunk spoken as the change took effect at the transmitter, never from the top, and every chunk after it in order.
      expect(firstIndex).toBeGreaterThan(0);
      expect(spokenAt).toBeGreaterThan(addedAt - 1_000);
      expect(spokenAt).toBeLessThan(addedAt + 1_500);
      expect(farHeard.decoded).toEqual(
        Array.from({ length: CHUNKS - firstIndex }, (_, i) => firstIndex + i),
      );

      // After its own light-time, not the near craft's.
      expect(crossing).toBeGreaterThan(FAR_SECONDS * 1000 - 800);
      expect(crossing).toBeLessThan(FAR_SECONDS * 1000 + 1_500);
      expect(crossing - NEAR_SECONDS * 1000).toBeGreaterThan(
        (FAR_SECONDS - NEAR_SECONDS) * 1000 - 1_000,
      );
    } finally {
      await closeAll(screens);
    }
  });
});
