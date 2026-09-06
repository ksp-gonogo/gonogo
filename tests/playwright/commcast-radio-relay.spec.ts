import { expect, test } from "@playwright/test";
import { PORTS } from "../../playwright.config";
import {
  closeAll,
  keyDown,
  keyUp,
  NAMES,
  NEAR,
  openConversation,
  openScreen,
  publishScene,
  reception,
  type Screen,
  speak,
  waitForReception,
} from "./commcast-radio-scene";
import { getHostPeerId } from "./helpers";

/**
 * One keying from a PEER is heard exactly once, everywhere.
 *
 * **A host-authored transmission structurally cannot find this.** The host's
 * own `CommcastMesh` sends by calling `host.broadcast` directly, one call per
 * keying, so however many host meshes are registered on `onCommcastRadio` the
 * frame still goes out once and every existing radio scene passes. A frame from
 * a PEER takes the other path: it arrives as a `commcast-radio` message and
 * every registered listener repeats it, so a second registration is a second
 * copy on the wire and a third is a third.
 *
 * That is what a station found: `createCommcastLog` registered the host's mesh
 * from inside a `useState` initialiser, and React invokes those more than once
 * under StrictMode, leaving live undisposed listeners that each re-broadcast.
 * The craft decoded every chunk three times, which a listener hears as a
 * stutter and which no assertion in the tree was positioned to see.
 *
 * A chunk has no id, so nothing downstream can dedupe it: the text log hides
 * exactly this defect (a message is deduped on its id) and the radio cannot.
 * Kept as its own scene, with no film and no light-time, because it is a
 * property of the WIRE and wants to fail in seconds rather than inside a
 * two-minute film.
 */

/** Short: this is a count, not a timing measurement. */
const CHUNKS = 25;

test.describe.configure({ timeout: 240_000 });

test.describe("commcast radio: the relay repeats a peer once @chromium-only", () => {
  test("a station keying is heard exactly once at the host and once at another peer", async ({
    browser,
  }, testInfo) => {
    await publishScene([PORTS.radioStream.ksc, PORTS.radioStream.near]);

    const videoDir = testInfo.outputPath("videos");
    const control = await openScreen(browser, {
      name: "mission-control",
      url: "/?uplinkLoaderIds=",
      dashboardKey: "gonogo:dashboard:main",
      sitrepPort: PORTS.radioStream.ksc,
      videoDir,
      clip: { name: "relay control", chunks: CHUNKS },
    });
    const shareCode = await getHostPeerId(control.page);
    const station = await openScreen(browser, {
      name: "station",
      url: `/station?host=${shareCode}&uplinkLoaderIds=`,
      dashboardKey: "gonogo:dashboard:station",
      sitrepPort: PORTS.radioStream.ksc,
      videoDir,
      clip: { name: "relay station", chunks: CHUNKS },
    });
    const pilot = await openScreen(browser, {
      name: "near-craft",
      url: `/pilot?host=${shareCode}&uplinkLoaderIds=`,
      dashboardKey: "gonogo:dashboard:main",
      sitrepPort: PORTS.radioStream.near,
      videoDir,
      clip: { name: "relay pilot", chunks: CHUNKS },
    });
    const screens: Screen[] = [station, control, pilot];

    try {
      await openConversation(station.page, NAMES[NEAR]);
      await keyDown(station.page);
      await speak(station.page, CHUNKS);
      /*
       * The HOST is the sharper of the two readings and the one that says where
       * the duplication is. It is co-located with the station, so its copy is
       * due immediately and owes nothing to a light-time; and every extra copy
       * it holds is one extra registered listener, since a host mesh both
       * repeats the frame and hands it to its own log.
       */
      await waitForReception(control.page, (r) => r.decoded.length >= CHUNKS, {
        timeout: 20_000,
        message: "mission control never heard the station",
      });
      await waitForReception(pilot.page, (r) => r.decoded.length >= CHUNKS, {
        timeout: 30_000,
        message: "the craft never heard the station",
      });
      await keyUp(station.page);
      // Long enough that a duplicate would have arrived and been counted. A
      // count asserted the instant the first copy lands would pass on a wire
      // sending four.
      await control.page.waitForTimeout(3_000);

      const atControl = await reception(control.page);
      const atPilot = await reception(pilot.page);
      console.info(
        `[radio-relay] ${CHUNKS} chunks keyed from the station: ${atControl.decoded.length} decoded at the host, ${atPilot.decoded.length} at the craft`,
      );
      const whole = Array.from({ length: CHUNKS }, (_, i) => i);
      expect(
        atControl.decoded,
        "the host repeated the station to itself more than once",
      ).toEqual(whole);
      expect(
        atPilot.decoded,
        "the host repeated the station onto the wire more than once",
      ).toEqual(whole);
      // And the station still never hears itself, on either path.
      expect((await reception(station.page)).decoded).toEqual([]);
    } finally {
      await closeAll(screens);
    }
  });
});
