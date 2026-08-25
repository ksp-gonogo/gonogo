import type { ComposedBurn } from "./__generated__/contract";
import type { ComposedPlan } from "./plan-composition";
import type { Value } from "./value";

/**
 * A plan being composed at a command centre, before anything has been sent.
 *
 * <p><b>Drafts live here and nowhere else.</b> The game holds at most the one
 * plan a vessel is flying, and holds nothing at all until a send puts something
 * there. Everything an operator is still deciding about is a command-centre
 * object, which is what lets two people work on different plans for the same
 * vessel at once: neither is touching the game, so neither can disturb the other
 * or the player at the keyboard.</p>
 *
 * <p><b>The observed instant is recorded when the draft is BUILT, not when it
 * is sent.</b> It says how old the information was that the operator decided
 * on, and that is a property of the moment they decided. Re-reading it at send
 * time would stamp a plan with the age of data nobody used, and the divergence
 * measured against it later would be measured against a fiction. A draft edited
 * later takes a new one, because the decision was made again.</p>
 */
export interface PlanDraft {
  /** This draft's own id, assigned by the command centre and never the game's. */
  id: string;

  /**
   * How many times what this draft would SEND has changed. Assigned by the store.
   *
   * <p><b>The id alone cannot be the intent's id.</b> The receiving side answers
   * a request id it has already seen out of its replay cache, without looking at
   * the plan that came with it, which is exactly right for a retransmission after
   * a silence and exactly wrong for an edit. A draft corrected and sent again
   * under the id its earlier version was sent under is answered with the EARLIER
   * receipt: the operator reads "aboard" about a plan the craft has never seen,
   * and every further correction reads the same way.</p>
   *
   * <p>So the intent is the draft's CONTENT, and this counts it. Only the fields
   * that travel move it: saving and reopening decide nothing about the plan, and
   * spending the repeat protection on an operator changing their mind about
   * whether they had finished typing would make a genuine retransmission apply
   * twice.</p>
   */
  revision: number;

  /** What the operator calls it. Never sent: the vessel has no use for a name. */
  name: string;

  /** Which vessel it is for. */
  vesselId?: string;

  burns: ComposedBurn[];

  /** How far the plan is asked to run. */
  desiredFinalTimeUt?: number;

  /** The instant the state this draft was built from was actually true. */
  observedAt: Value<"ut">;

  /**
   * Whether the operator has finished composing this one.
   *
   * <p>The difference between a plan being WRITTEN DOWN and a plan being aboard
   * a vessel is the most important distinction this surface has, and a single
   * button cannot express it. A draft is composed, then saved, and only a saved
   * one is offered for transmission: a half-typed burn cannot be sent by a
   * misplaced press, and sending is a deliberate second act rather than the end
   * of editing.</p>
   */
  saved?: boolean;
}

/**
 * The command centre's own plans, held per vessel.
 *
 * <p>Deliberately not a React thing and deliberately not persistent. It is a
 * plain observable collection so the same drafts can be read by a widget, a
 * test, or anything else without a renderer, and so what persistence a screen
 * wants is that screen's decision rather than baked in here.</p>
 */
export class PlanDraftStore {
  private readonly drafts = new Map<string, PlanDraft>();
  private readonly listeners = new Set<() => void>();
  private nextId = 1;

  /**
   * A stable snapshot, newest last.
   *
   * <p>Rebuilt only when something changed, because `useSyncExternalStore`
   * compares by identity and a fresh array every call is an infinite render.
   * This is the bug that shape invites, so the cache is the point rather than
   * an optimisation.</p>
   */
  private snapshot: readonly PlanDraft[] = [];

  list(): readonly PlanDraft[] {
    return this.snapshot;
  }

  get(id: string): PlanDraft | undefined {
    return this.drafts.get(id);
  }

  forVessel(vesselId: string | undefined): readonly PlanDraft[] {
    return this.snapshot.filter((draft) => draft.vesselId === vesselId);
  }

  /**
   * Starts a draft and returns it.
   *
   * <p>The id is the store's own counter rather than anything derived from the
   * contents: two drafts with identical burns are still two drafts, because an
   * operator made them separately and may be comparing them.</p>
   */
  create(draft: Omit<PlanDraft, "id" | "revision">): PlanDraft {
    const created: PlanDraft = {
      ...draft,
      id: `draft-${this.nextId}`,
      revision: 1,
    };
    this.nextId += 1;
    this.drafts.set(created.id, created);
    this.changed();
    return created;
  }

  /**
   * Replaces a draft's contents. Returns the updated draft, or undefined when
   * no such draft exists.
   *
   * <p>A caller supplying new burns must supply the instant they were composed
   * against with them: editing a plan is deciding again, and carrying the old
   * instant forward would date the new decision by the old one's information.
   * </p>
   */
  update(
    id: string,
    changes: Partial<Omit<PlanDraft, "id" | "revision">>,
  ): PlanDraft | undefined {
    const existing = this.drafts.get(id);
    if (existing === undefined) {
      return undefined;
    }
    const updated: PlanDraft = {
      ...existing,
      ...changes,
      id,
      revision: existing.revision + (touchesTheWire(changes) ? 1 : 0),
    };
    this.drafts.set(id, updated);
    this.changed();
    return updated;
  }

  /** Discards a draft. True when there was one to discard. */
  remove(id: string): boolean {
    const had = this.drafts.delete(id);
    if (had) {
      this.changed();
    }
    return had;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private changed(): void {
    this.snapshot = [...this.drafts.values()];
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/**
 * Which of a draft's fields reach the craft, so a change to one of them is a
 * different intent and a change to the rest is not.
 */
const WIRE_FIELDS = [
  "burns",
  "observedAt",
  "vesselId",
  "desiredFinalTimeUt",
] as const satisfies readonly (keyof PlanDraft)[];

function touchesTheWire(changes: Partial<Omit<PlanDraft, "id">>): boolean {
  return WIRE_FIELDS.some((field) => field in changes);
}

/**
 * A draft in the shape the send hook takes.
 *
 * <p>The name is dropped, because the vessel has no use for one. The request id
 * is the draft AT ITS REVISION, not the draft: a retransmission of the same
 * plan carries the same id and is recognised as the same intent rather than
 * applied twice, and an edited plan carries a new one so the receiving side
 * cannot answer it out of the receipt it kept for the version before. See
 * {@link PlanDraft.revision}.</p>
 */
export function draftAsPlan(draft: PlanDraft): ComposedPlan {
  return {
    burns: draft.burns,
    observedAt: draft.observedAt,
    vesselId: draft.vesselId,
    requestId: `${draft.id}@${draft.revision}`,
    desiredFinalTimeUt: draft.desiredFinalTimeUt,
  };
}
