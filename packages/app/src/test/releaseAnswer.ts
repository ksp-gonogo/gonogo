import {
  checkLatestRelease,
  LATEST_RELEASE_URL,
} from "../settings/releaseCheck";

/**
 * What GitHub's release list answers in a test that does not say otherwise:
 * nothing published. An entry here is one release, as GitHub lists it
 * (`tag_name`, `html_url`).
 */
const RELEASES: readonly unknown[] = [];

/**
 * Puts the answer to the release check in hand before any test in the file
 * runs, from {@link RELEASES} and without the network.
 *
 * The main screen's update banner asks GitHub once per page load, which in a
 * suite is once per file. Left to the network the reply arrives whenever
 * GitHub sends it, in the middle of whichever test is running by then, and a
 * reply that differs from "not known yet" redraws the banner outside act. With
 * the answer already in hand the banner starts on it and the check changes
 * nothing.
 *
 * A test that needs another answer forgets this one with
 * `__resetLatestRelease()` and gives its own.
 */
export async function answerReleaseCheck(): Promise<void> {
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) =>
    String(input instanceof Request ? input.url : input) === LATEST_RELEASE_URL
      ? new Response(JSON.stringify(RELEASES), { status: 200 })
      : real(input, init);
  try {
    await checkLatestRelease();
  } finally {
    globalThis.fetch = real;
  }
}
