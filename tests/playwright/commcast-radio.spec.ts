/**
 * Two and three real screens, keying a real radio at each other over the real
 * mesh, and hearing each other one light-time later.
 *
 * **Every radio test before this one exercised ONE side.** `RadioSession` runs
 * against a stub, `clips.roundtrip` compares sample for sample, `RadioPtt`
 * renders alone, and the render harness mounts two panes whose logs are seeded
 * rather than connected. So the delay model's central claim, that a
 * transmission is due at DIFFERENT wall instants at different vantages, was
 * structurally invisible: one side cannot disagree with itself about when it
 * is.
 *
 * What is real here: the widget, the composer, the push-to-talk key, the
 * transmitter, `CommcastMesh` over PeerJS, `CommcastLog`, `RadioSession`, the
 * delayed playout buffer, the pacer, and each screen's own view clock. What is
 * substituted is the microphone and the codec, through the seam `backend.ts`
 * was built to offer and `InjectedRadioBackend` finally provides: a recorded
 * clip in, a recording sink out, on both ends.
 *
 * ## The three screens, and why there are three
 *
 * Two screens can only show a light-time being SYMMETRIC, because a separation
 * is. The sentence worth proving is that ONE transmission is due at two
 * different instants, and that needs a third vantage:
 *
 *   - mission control at `ksc`, hosting the mesh, on `/`
 *   - a pilot 3 s away at `vessel:near`, on `/pilot`
 *   - a pilot 9 s away at `vessel:far`, on `/pilot`
 *
 * Radio is a BROADCAST in this model: `RadioSession.begin` registers any
 * transmission it has a path to, and never asks whether this vantage was
 * addressed. So mission control keying once is heard by both craft, six
 * seconds apart, off the same bytes.
 *
 * ## The light, and the leak it must not have
 *
 * `RadioReception.live` is populated only when a chunk is PRESENTED, never on
 * the `start` frame, because `start` crosses at the speed of the internet: a
 * lamp lit by the envelope would announce a speaker a light-minute before
 * their first word. That is asserted here in the only place it can be, with a
 * real wire under it, and it is planted in both directions rather than
 * assumed:
 *
 *   - it must be DARK while the words are crossing, with the transmitter
 *     provably already talking
 *   - it must not be dark merely because nothing arrived. The far end decodes
 *     the utterance from CHUNK ZERO, in order, in about the wall time the clip
 *     lasts, after a silence several times longer: audio that was held and
 *     released, which a wire that only woke up late cannot produce
 *   - and the second test is the strongest plant of all. If the lamp were lit
 *     by the envelope, both craft would light together; they light six seconds
 *     apart, which no internet hop explains
 *
 * ## The video, and the audio in it
 *
 * Recorded per screen (`video: "on"`) and stacked side by side into one mp4,
 * attached to the run. A timing failure is a thing you SEE: a jittered
 * playout, a lamp that lights before the words could have arrived, a
 * transmission that fades at the wrong instant. It is deliberately NOT routed
 * through the `visual` job, which diffs deterministic stills and is a
 * different instrument entirely.
 *
 * **The film has SOUND, and it is not a recording of a speaker.** Playwright
 * records video only, a hard limit of the Chromium screencast API, so there is
 * no audio track to be had from the recorder at any setting. What there is
 * instead is better evidence: the decoder each screen actually runs writes its
 * PCM into a sink this test owns, so the samples can be teed off with the wall
 * instant they reached the speakers, dumped as one WAV per screen and muxed
 * back under that screen's own pane. What you hear is therefore what the code
 * produced at that vantage, already on the same clock as its picture, rather
 * than what a device emitted into a room. Each pane is panned to where it sits
 * on screen, so which craft is talking is audible as well as visible.
 *
 * ## And it is paced for a human
 *
 * The delay ARITHMETIC is untouched, and must stay untouched: three seconds and
 * nine seconds are the subject. What is stretched is everything around it. The
 * scene holds still before the key and after the last word, the utterance is
 * three seconds rather than one, and nothing is hurried between them. That last
 * one is the load-bearing change: with a one-second clip the near craft's lamp
 * lit at +3 s and went dark at +4 s, five seconds before the far craft lit at
 * all, so THE one frame worth seeing (near lit, far still dark) was a
 * twenty-five frame flicker. At three seconds it is three seconds.
 */
import { expect, test } from "@playwright/test";
import { PORTS } from "../../playwright.config";
import {
  closeAll,
  FAR_SECONDS,
  HOLD_MS,
  keyDown,
  keyUp,
  NAMES,
  NEAR,
  NEAR_SECONDS,
  openConversation,
  openScreen,
  publishScene,
  reception,
  speak,
  stackVideos,
  voiceRibbon,
  waitForReception,
} from "./commcast-radio-scene";
import { getHostPeerId } from "./helpers";

/**
 * Three seconds of somebody talking, at 20 ms a chunk.
 *
 * Built here rather than taken from the named clips, because the length is a
 * property of THIS scene: what an utterance has to outlast is the six seconds
 * between the two craft hearing it, and none of the shared clips is written for
 * that. `makeClip` is the same deterministic constructor they are all built
 * with, so nothing about the audio is sampled or seeded.
 *
 * Three seconds specifically. The near craft's lamp is lit for as long as the
 * words last, so a shorter utterance puts the whole "near lit, far dark" window
 * inside a second of film and the one frame the scene exists to show goes past
 * before a human can register it.
 */
const CLIP_CHUNKS = 150;
const CLIP_SECONDS = 3;

const CLIP = { name: "say again your status", chunks: CLIP_CHUNKS };

// Recorded for every run: the film IS the deliverable here, not a failure
// artifact, and a timing defect is far easier to see than to reason back from.
test.use({ video: "on" });

// Three page loads, a peer handshake each, and a nine-second crossing to wait
// out. The default 60 s is not enough and the slowness is the subject.
test.describe.configure({ timeout: 180_000 });

/**
 * Chromium only, and MEASURED rather than assumed.
 *
 * On chromium this is steady: three consecutive runs put the near craft at
 * 3.03 s and the far one at 9.03, 9.03 and 9.04 against separations of 3 and 9.
 * On firefox the three-screen measurement passed twice at +3.04 / +9.04, and
 * the two-screen one hears nothing at all in three runs out of four: the craft
 * boots, joins the mesh and renders, and the audio never arrives. That is a
 * peer-establishment flake between two fresh firefox contexts rather than
 * anything the radio owns, and a timing measurement that silently loses its
 * subject is worse than one that does not run. Webkit is untried.
 *
 * The delay ARITHMETIC is engine-independent and covered per engine already;
 * what is scoped here is the three-context WebRTC scene it is measured over.
 */
test.describe("commcast radio: two screens hearing each other @chromium-only", () => {
  test("mission control keys, and the craft hears it one light-time later", async ({
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
      clip: CLIP,
    });
    const shareCode = await getHostPeerId(control.page);
    const craft = await openScreen(browser, {
      name: "near-craft",
      url: `/pilot?host=${shareCode}&uplinkLoaderIds=`,
      dashboardKey: "gonogo:dashboard:main",
      sitrepPort: PORTS.radioStream.near,
      videoDir,
      clip: CLIP,
    });
    const screens = [control, craft];

    try {
      // Both screens settled, both quiet, nobody keyed. The film opens on the
      // instrument at rest, because a change is only readable against one.
      await control.page.waitForTimeout(HOLD_MS);
      await openConversation(control.page, NAMES[NEAR]);
      /*
       * The rail is EMPTY before the key, and that is half of the assertion
       * below. An idle transmitter publishes no crossing, so a ribbon here
       * would mean the rail was drawing something nobody registered.
       */
      await expect(voiceRibbon(control.page)).toHaveCount(0);
      await control.page.waitForTimeout(HOLD_MS);

      const keyedAt = await keyDown(control.page);
      await speak(control.page);

      /*
       * The other half: keyed, the operator's own voice is drawn crossing the
       * gap on the panel's delay rail. `RadioPtt` registers it while the key is
       * down and `useRadio` carries the captured loudness into it, and this is
       * the only place the two ends of that wiring meet a real rail.
       */
      await expect(voiceRibbon(control.page)).toBeVisible();

      /*
       * A second and a bit in: the transmitter is provably mid-sentence and the
       * craft has been told nothing. That pairing is the assertion, not either
       * half of it. A dark lamp on its own is what a broken wire looks like,
       * and a talking transmitter on its own says nothing about the far end.
       */
      await control.page.waitForTimeout(1_200);
      const early = await reception(craft.page);
      const sending = await reception(control.page);
      expect(
        sending.spoken,
        "mission control should be mid-sentence by now",
      ).toBeGreaterThan(30);
      expect(early.firstDecodeAt, "the words have not arrived yet").toBeNull();
      expect(
        early.litAt,
        "and the lamp must not announce a speaker before their first word",
      ).toBeNull();

      /*
       * Held to the end of the utterance, then released. It has to be the end:
       * a microphone whose capture is stopped mid-clip stops emitting, so an
       * early key-up would put half an utterance on the wire and the "arrived
       * whole, in order" assertion below would be asserting a different thing.
       * The claim it used to make from an early release survives intact and is
       * made a beat later, because at three seconds out the first word has
       * still not landed when the key comes up: `end` crosses at the speed of
       * the internet while every word it ends is still in flight.
       */
      await control.page.waitForTimeout(CLIP_SECONDS * 1000);
      await keyUp(control.page);
      // And the ribbon goes with the key, rather than being left on the rail.
      await expect(voiceRibbon(control.page)).toHaveCount(0);

      await waitForReception(craft.page, (r) => r.firstDecodeAt !== null, {
        timeout: 30_000,
        message: "the craft never heard the transmission",
      });
      // Long enough for the whole utterance to play out at natural rate.
      await craft.page.waitForTimeout(CLIP_SECONDS * 1000 + 1_500);
      const heard = await reception(craft.page);

      const crossing = (heard.firstDecodeAt as number) - keyedAt;
      console.info(
        `[radio] near craft first heard ${(crossing / 1000).toFixed(2)}s after key-down (separation ${NEAR_SECONDS}s)`,
      );
      // Generous on both sides: the key catches a frame or two after the click,
      // and the clock is anchored on a stream re-emitting at 200 ms. Tight
      // enough that a missing delay (0 s) and a doubled one (6 s) both fail.
      expect(crossing).toBeGreaterThan(NEAR_SECONDS * 1000 - 800);
      expect(crossing).toBeLessThan(NEAR_SECONDS * 1000 + 1_500);

      /*
       * The other direction of the plant. The craft heard the utterance from
       * CHUNK ZERO, in order, and played it out in about the three seconds it
       * lasts, after three seconds of silence: audio that was HELD and released
       * on a clock. A wire that had simply been dead for those three seconds
       * would have lost its opening chunks, and a lamp lit by the envelope would
       * have lit before any of this.
       */
      expect(heard.decoded).toEqual(
        Array.from({ length: CLIP_CHUNKS }, (_, i) => i),
      );
      /*
       * ONE listening chain took the whole utterance. Worth asserting
       * separately from the sequence above because the two failures look alike
       * in it: a session rebuilt mid-transmission SPLITS the clip across two
       * chains, and a duplicate delivery decodes every chunk twice. The second
       * of those is not hypothetical, it is what this scene found on its first
       * run, and `PilotScreen` now disconnects its peer on teardown because of
       * it.
       */
      expect(heard.decoderLengths).toEqual([CLIP_CHUNKS]);
      const playout =
        (heard.lastDecodeAt as number) - (heard.firstDecodeAt as number);
      expect(playout).toBeGreaterThan(CLIP_SECONDS * 1000 * 0.5);
      expect(playout).toBeLessThan(CLIP_SECONDS * 1000 * 2.5);

      // The lamp went dark again once the audio it named had finished, rather
      // than at the `end` frame that arrived seconds earlier.
      expect(heard.darkAt).not.toBeNull();
      expect(
        (heard.darkAt as number) - (heard.litAt as number),
      ).toBeGreaterThan(CLIP_SECONDS * 1000 * 0.5);

      // Nobody hears their own voice back off the relay, which is what
      // `authorStationKey` is repeated on every frame for.
      const selfHeard = await reception(control.page);
      expect(selfHeard.decoded).toEqual([]);
      expect(selfHeard.litAt).toBeNull();

      // The film's last held frame: both lamps dark again, nothing keyed, the
      // scene back where it started. Without it the recording cuts on the same
      // frame as the last assertion and there is nothing to read the end
      // against.
      await control.page.waitForTimeout(HOLD_MS);
    } finally {
      await closeAll(screens);
      await stackVideos(screens, testInfo);
    }
  });

  test("one transmission, two craft, two different wall instants", async ({
    browser,
  }, testInfo) => {
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
      clip: CLIP,
    });
    const shareCode = await getHostPeerId(control.page);
    const near = await openScreen(browser, {
      name: "near-craft",
      url: `/pilot?host=${shareCode}&uplinkLoaderIds=`,
      dashboardKey: "gonogo:dashboard:main",
      sitrepPort: PORTS.radioStream.near,
      videoDir,
      clip: CLIP,
    });
    const far = await openScreen(browser, {
      name: "far-craft",
      url: `/pilot?host=${shareCode}&uplinkLoaderIds=`,
      dashboardKey: "gonogo:dashboard:main",
      sitrepPort: PORTS.radioStream.far,
      videoDir,
      clip: CLIP,
    });
    const screens = [near, control, far];

    try {
      // Three screens up, three lamps dark. Held, so the film has a rest state.
      await control.page.waitForTimeout(HOLD_MS);

      // Addressed to the near craft. The far craft is not a recipient and hears
      // it anyway, because radio is a broadcast: a session registers any
      // transmission it has a path to and never asks whether it was addressed.
      await openConversation(control.page, NAMES[NEAR]);
      await expect(voiceRibbon(control.page)).toHaveCount(0);
      await control.page.waitForTimeout(HOLD_MS);

      const keyedAt = await keyDown(control.page);
      await speak(control.page);
      // Keyed, and the operator's own voice is on their own rail while it is.
      await expect(voiceRibbon(control.page)).toBeVisible();
      await control.page.waitForTimeout(CLIP_SECONDS * 1000 + 300);
      await keyUp(control.page);
      await expect(voiceRibbon(control.page)).toHaveCount(0);

      for (const craft of [near, far]) {
        await waitForReception(craft.page, (r) => r.firstDecodeAt !== null, {
          timeout: 40_000,
          message: `${craft.name} never heard the transmission`,
        });
      }
      // Let the far craft finish playing what it was still holding.
      await far.page.waitForTimeout(CLIP_SECONDS * 1000 + 1_000);

      const nearHeard = await reception(near.page);
      const farHeard = await reception(far.page);
      const nearAt = (nearHeard.firstDecodeAt as number) - keyedAt;
      const farAt = (farHeard.firstDecodeAt as number) - keyedAt;
      console.info(
        `[radio] one keying, heard at +${(nearAt / 1000).toFixed(2)}s (near, ${NEAR_SECONDS}s) and +${(farAt / 1000).toFixed(2)}s (far, ${FAR_SECONDS}s)`,
      );

      expect(nearAt).toBeGreaterThan(NEAR_SECONDS * 1000 - 800);
      expect(nearAt).toBeLessThan(NEAR_SECONDS * 1000 + 1_500);
      expect(farAt).toBeGreaterThan(FAR_SECONDS * 1000 - 800);
      expect(farAt).toBeLessThan(FAR_SECONDS * 1000 + 1_500);

      /*
       * The whole claim in one line, and the strongest plant against a lamp lit
       * by the envelope: `start` reaches both craft in the same internet
       * millisecond, so an envelope-driven light would put this difference at
       * roughly zero. It is six seconds.
       */
      const gap = farAt - nearAt;
      expect(gap).toBeGreaterThan((FAR_SECONDS - NEAR_SECONDS) * 1000 - 1_000);
      expect(gap).toBeLessThan((FAR_SECONDS - NEAR_SECONDS) * 1000 + 1_000);

      // The SAME audio, arriving at two different times: identical chunk
      // sequences, from the same keying, decoded independently at two vantages.
      const wholeClip = Array.from({ length: CLIP_CHUNKS }, (_, i) => i);
      expect(nearHeard.decoded).toEqual(wholeClip);
      expect(farHeard.decoded).toEqual(wholeClip);

      // Held on three quiet screens again, so the film ends where it opened.
      await control.page.waitForTimeout(HOLD_MS);
    } finally {
      await closeAll(screens);
      await stackVideos(screens, testInfo);
    }
  });
});
