import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";
import type { RadioBackend } from "./backend";
import { RadioBackendProvider } from "./backend";

/**
 * The provider `backend.ts` was missing: a radio backend the PAGE installs.
 *
 * `RadioBackend` exists because the microphone and the decoder are injected
 * rather than reached for, and it names the reason in as many words: a machine
 * may legitimately have no input to give, and an automated exercise of a keying
 * end to end can have neither a device nor a secure context. The seam stopped
 * at the app, which provided nothing and so always ran on
 * `WEB_AUDIO_RADIO_BACKEND`, which is why a browser-level test of the radio has
 * only ever been able to ask whether the codec exists.
 *
 * What is substituted is exactly the microphone and the decoder. The
 * transmitter, the wire, the mesh, the session, the delay arithmetic and the
 * widget are all the shipped ones, and a page that installs nothing gets the
 * real backend with nothing between it and the operator.
 *
 * ## Dev-only, on purpose
 *
 * The read is behind `import.meta.env.DEV`, which the production build replaces
 * with `false`, so a shipped page cannot have its microphone swapped by
 * anything that can reach `globalThis`. It is also why the CLIP lives nowhere
 * near here: the page builds the backend itself and hands it over, so no
 * recorded audio and no stand-in codec is in the app's module graph at all.
 * Playwright reaches `clips.ts` through the dev server's own module URL.
 *
 * ## Installing one
 *
 * ```js
 * const clips = await import("/src/commcast/radio/clips.ts");
 * const radio = clips.clipRadio(clips.SHORT_CLIP);
 * window.__gonogoRadioBackend = radio.backend;
 * window.dispatchEvent(new Event("gonogo:radio-backend"));
 * ```
 *
 * The event is what makes it take effect on a page that has already booted:
 * `useRadio` rebuilds both halves when the backend changes identity, so an
 * install after mount tears down the real chain and stands a fresh one up on
 * the injected one, rather than leaving a session wired to a decoder nobody
 * asked for.
 */

/** Where a page leaves the backend it wants the radio to run on. */
const BACKEND_KEY = "__gonogoRadioBackend";

/** Dispatched on `globalThis` once the handle above has been set or cleared. */
const CHANGED_EVENT = "gonogo:radio-backend";

/**
 * Whether `held` is a backend, rather than merely present.
 *
 * Both halves are checked because a HALF-installed handle is the dangerous
 * shape: accepting it would take the real microphone away and then fail at the
 * first keying, which reads as a broken radio rather than as a broken install.
 */
function isRadioBackend(held: unknown): held is RadioBackend {
  if (typeof held !== "object" || held === null) return false;
  const candidate = held as Partial<RadioBackend>;
  return (
    typeof candidate.startCapture === "function" &&
    typeof candidate.createReceiver === "function"
  );
}

function injectedBackend(): RadioBackend | null {
  if (!import.meta.env.DEV) return null;
  const held = (globalThis as Record<string, unknown>)[BACKEND_KEY];
  return isRadioBackend(held) ? held : null;
}

function subscribe(onChange: () => void): () => void {
  globalThis.addEventListener(CHANGED_EVENT, onChange);
  return () => globalThis.removeEventListener(CHANGED_EVENT, onChange);
}

/** Runs the radio under this tree on the page's backend, where it installed one. */
export function InjectedRadioBackend({ children }: { children: ReactNode }) {
  const backend = useSyncExternalStore(subscribe, injectedBackend);
  if (backend === null) return <>{children}</>;
  return (
    <RadioBackendProvider value={backend}>{children}</RadioBackendProvider>
  );
}
