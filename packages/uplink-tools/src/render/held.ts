import type { ScenePayload, SceneReport } from "../render-probe";
import { UNANNOUNCED_MARK } from "./probe-global";
import type { Scene } from "./scenes";

/**
 * Whether a subject says the link has gone, judged from two renders of one
 * scene: live, and with the link dropped.
 *
 * <p>Every render the harness takes of a stream-fed scene gets a twin with the
 * other `stopsArriving` value, so an Uplink needs no held fixture for its
 * widgets to be held to this. A scene that already stages the drop is compared
 * with itself fed live; one that does not is compared with itself dropped.</p>
 *
 * <p>Two ways to fail. UNCHANGED: the subject draws exactly the same elements
 * both ways, so an operator has nothing to tell a figure from twenty minutes ago
 * from one that just arrived. UNANNOUNCED: the subject draws a held mark with
 * no caption, so the dot is there and a screen reader is told nothing.</p>
 *
 * <p>A guest drawn inside a real host is judged on what IT draws. The host may
 * mark its own readings, and a render that changed only because the host did is
 * the case this exists for: a correctly marked panel carrying a figure nobody
 * marked. So a hosted scene is also rendered with its guest withheld, in both
 * states, and the guest's elements are what is left after the host's are taken
 * away.</p>
 */
export interface HeldRenders {
  live: readonly string[];
  held: readonly string[];
  /** The same two renders with the guest withheld, for a hosted scene. */
  hostOnly?: { live: readonly string[]; held: readonly string[] };
}

export interface HeldVerdict {
  /** The subject drew the same elements live and with the link dropped. */
  unchanged: boolean;
  /** How many of the subject's elements differ between the two, counted both ways. */
  changed: number;
  /** The differing elements, `-` drawn only live and `+` only with the link dropped. */
  differences: string[];
  /** How many elements the subject drew live, and with the link dropped, bare wrappers not counted. */
  drawn: { live: number; held: number };
  /** Elements the subject drew held with no caption saying so. */
  unannounced: string[];
}

/** What `from` has that `take` does not, counting repeats. */
export function multisetMinus(
  from: readonly string[],
  take: readonly string[],
): string[] {
  const left = new Map<string, number>();
  for (const line of take) left.set(line, (left.get(line) ?? 0) + 1);
  const out: string[] = [];
  for (const line of from) {
    const n = left.get(line) ?? 0;
    if (n > 0) left.set(line, n - 1);
    else out.push(line);
  }
  return out;
}

/**
 * An element with no text of its own and nothing but a class: a layout wrapper.
 * See {@link judgeHeld} for when one is not counted.
 */
function isBareWrapper(line: string): boolean {
  return /^<[a-z0-9-]+ (class="[^"]*")?> $/.test(line);
}

function tagOf(line: string): string {
  return line.slice(1, line.indexOf(" "));
}

/**
 * Drop a bare wrapper that appears on one side only with no bare wrapper of its
 * tag on the other. A layout box a host adds or removes around its guest says
 * nothing to an operator; the same box restyled (a dimmed class in place of a
 * lit one) appears on both sides and is kept.
 */
function withoutLoneWrappers(
  gone: readonly string[],
  added: readonly string[],
): { gone: string[]; added: string[] } {
  const bareTags = (lines: readonly string[]) =>
    new Set(lines.filter(isBareWrapper).map(tagOf));
  const goneTags = bareTags(gone);
  const addedTags = bareTags(added);
  return {
    gone: gone.filter((l) => !isBareWrapper(l) || addedTags.has(tagOf(l))),
    added: added.filter((l) => !isBareWrapper(l) || goneTags.has(tagOf(l))),
  };
}

export function judgeHeld(renders: HeldRenders): HeldVerdict {
  const subjectLive = renders.hostOnly
    ? multisetMinus(renders.live, renders.hostOnly.live)
    : renders.live;
  const subjectHeld = renders.hostOnly
    ? multisetMinus(renders.held, renders.hostOnly.held)
    : renders.held;
  const { gone, added } = withoutLoneWrappers(
    multisetMinus(subjectLive, subjectHeld),
    multisetMinus(subjectHeld, subjectLive),
  );
  const differences = [
    ...gone.map((line) => `- ${line}`),
    ...added.map((line) => `+ ${line}`),
  ];
  const changed = differences.length;
  const unchanged = changed === 0;
  return {
    unchanged,
    changed,
    differences,
    drawn: {
      live: subjectLive.filter((l) => !isBareWrapper(l)).length,
      held: subjectHeld.filter((l) => !isBareWrapper(l)).length,
    },
    unannounced: subjectHeld.filter((line) => line.endsWith(UNANNOUNCED_MARK)),
  };
}

/** The page calls one held render is made of. */
export interface HeldStage {
  /** Mount the scene with the drop held back. */
  mount(payload: ScenePayload): Promise<SceneReport>;
  act(scene: Scene, missing: "throw" | "skip"): Promise<void>;
  refeed(): Promise<void>;
  /** Drop the link if the payload stops arriving, then read the render. */
  finish(): Promise<SceneReport>;
  read(): Promise<SceneReport>;
}

/**
 * One render of a scene for the held comparison, live or dropped as the
 * payload says, in the state the scene pictures.
 *
 * <p>The render in the scene's own state is the fed render again, so it drops
 * the link where the fed render does, before the presses. The twin with the
 * other state holds its drop until the presses have run: a scene driven by
 * presses is judged pressed, and a link that goes after them is the order an
 * operator meets it.</p>
 *
 * <p>A still is refed after the presses, as its picture is; a motion scene is
 * not, because its first frame is taken before the refeed. With a guest
 * withheld, a press that finds no control is skipped: the control was the
 * guest's, and the host without it is in the state the press leaves it.</p>
 */
export async function mountForHeld(
  stage: HeldStage,
  scene: Scene,
  payload: ScenePayload,
): Promise<SceneReport> {
  const twin =
    (payload.stopsArriving === true) !== (scene.stopsArriving === true);
  await stage.mount({ ...payload, holdDrop: true });
  if (!twin) await stage.finish();
  await stage.act(scene, payload.withhold ? "skip" : "throw");
  if (!(scene.steps && scene.steps.length > 0)) await stage.refeed();
  return twin ? stage.finish() : stage.read();
}
