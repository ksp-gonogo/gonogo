import { channelKindOf } from "../channel-tags";
import { CORE_CONTRACT_OWNER } from "../contract-tags";
import type {
  AnyReckonerDefinition,
  DepWindows,
  ReckonerDefinition,
  ReckonerInputRule,
} from "../reading";
import { reckonableValuesOf } from "../reckonability";
import type { TopicId, TopicPayload } from "../topics";
import type { Dep } from "./processors";

/**
 * Per-topic forward models, registered at module load the same way components
 * and themes are: a module that owns a model calls `registerReckoner` and the
 * store picks it up, with no wiring in between.
 *
 * A module-level registry rather than a `TimelineStore` method because the model
 * belongs to whoever owns the topic (a widget, an Uplink), and that module is
 * imported long before any store exists.
 *
 * ## Keyed by (topic, owner), and a contest falls back to core
 *
 * This was a bare `Map<topic, reckoner>` with last-registration-wins, which is
 * the design `units.ts` considered and rejected for the same shape of problem,
 * in its own words: "the maps are whole-Topic, so last-write-wins between two
 * installed providers would clobber core's own units for that Topic". Its
 * answer, a registry keyed by owner so two providers write two entries and
 * never collide, is the one here.
 *
 * Last-write-wins is also not election, whatever it is called: the winner is
 * decided by module import order, which is a fact about the bundler. A real
 * conflict is two Uplinks both claiming to model one topic, and the honest
 * answer is to serve neither of them: a reading carrying whichever model
 * happened to load second is a confident picture assembled by accident, and
 * `Reading`'s own doc is explicit that a wrong reckoner is worse than none. Same
 * resolution `getResolvedComponents` uses for two widgets claiming one
 * replacement target: withhold both, surface the conflict, never silently merge.
 *
 * What withholding both must not mean is serving nothing while core holds a
 * working vanilla for the same topic. See {@link getReckoner}: the contest
 * withdraws the contenders and core's own model answers.
 *
 * Re-registration under the same owner is last-write-wins and deliberately not
 * an error, matching `defineUplinkClient`: a module re-evaluating under HMR or
 * a test re-importing after `resetModules` is a benign single-owner case, and
 * there is no cross-package collision to guard against within one owner.
 */
const reckoners = new Map<string, Map<string, AnyReckonerDefinition>>();

/**
 * The owner the SDK's own vanilla forward models register under. Useful for
 * telling a model that ships with the SDK from one an Uplink supplies. Used by the
 * SDK's built-in reckoners. An Uplink cannot use it: `defineUplinkClient` stamps
 * the client's own id, and `CORE_UPLINK_CLIENT` is the one handle carrying this
 * one.
 */
export const CORE_RECKONER_OWNER = CORE_CONTRACT_OWNER;

/**
 * Registers `owner`'s forward model for `topic`. Useful for carrying a reading
 * forward between samples so the operator sees a current value rather than the
 * last one received. Used by the maneuver planner, the transfer window and the
 * system diagram. `owner` names the Uplink that owns the model and is required;
 * an Uplink client calls its handle's bound `registerReckoner`, which supplies it.
 *
 * `topic` is a `TopicId`, and the payload type is resolved from it
 * (`TopicPayload<Topic>`). `Deps` and `Projection` are inferred, so a definition
 * annotates neither. An Uplink-owned Topic is in the union once the Uplink's
 * client augments `TopicPayloadMap` in a `declare module "@ksp-gonogo/sitrep-sdk"`
 * block.
 */
export function registerReckoner<
  const Topic extends TopicId,
  Projection = TopicPayload<Topic>,
  const Deps extends readonly Dep[] = readonly Dep[],
  const Windows extends DepWindows<Deps> = Record<never, never>,
>(
  topic: Topic,
  owner: string,
  reckoner: ReckonerDefinition<TopicPayload<Topic>, Projection, Deps, Windows>,
): void {
  /*
   * `owner` is a required argument rather than a convention because ownership has
   * to be readable by something other than a person: the boundary ratchet and any
   * health surface both want to know which Uplink is modelling what. An Uplink
   * client should call its handle's bound `registerReckoner` instead of naming
   * itself here.
   */
  /*
   * A model with no mark behind it is served when it answers and invisible when
   * it refuses: a decline is explained from the marks, so without one a refusal
   * reads as "nobody models this" and a consumer goes on to compute from the raw
   * values the model just withheld.
   */
  if (channelKindOf(topic) === "event") {
    throw new Error(
      `registerReckoner("${topic}", "${owner}"): ${topic} is an Event channel. Each sample is one ` +
        "occurrence at its own time, so there is nothing between two of them to carry forward.",
    );
  }
  if (reckonableValuesOf(topic, owner).length === 0) {
    throw new Error(
      `registerReckoner("${topic}", "${owner}"): "${owner}" declares no value of ${topic} reckonable.\n\n` +
        "A model is registered for a value its owner's contract marks, so that when it declines the " +
        "reading says why rather than reading as unmodelled. Mark the value with [SitrepReckonable] on " +
        `the payload property in your own contract, or with [assembly: SitrepReckonableOn("${topic}", ...)] ` +
        "for a Topic another owner publishes, and pass the generated tags to defineUplinkClient.",
    );
  }
  const requireReason = (
    rule: string,
    reason: string | undefined,
    where: string,
    present: boolean,
  ) => {
    if (present && (reason === undefined || reason.trim() === "")) {
      throw new Error(
        `registerReckoner("${topic}", "${owner}"): the ${rule} exemption${where} carries no reason.\n\n` +
          "The store applies the input rules to every model by default, and an " +
          "opt-out is only reviewable if it says what makes it sound. Write the " +
          "reason as the value:\n" +
          `  exempt: { ${rule}: "this input only seeds the integration and is never read again" }`,
      );
    }
  };
  const exempt = reckoner.exempt;
  if (exempt) {
    requireReason("horizon", exempt.horizon, "", exempt.horizon !== undefined);
    requireReason("band", exempt.band, "", exempt.band !== undefined);
    /*
     * `perBasis` holds one opt-out SET per basis rather than a reason of its
     * own, so its reasons are two levels down: basis, then rule, then input.
     * Walked with the typed shape rather than `Object.entries` over the whole
     * `exempt` object, which could only see its values as `unknown`.
     */
    const declaredInputs = new Set<string>();
    for (const dep of reckoner.deps) {
      if (typeof dep === "string") {
        declaredInputs.add(dep);
        continue;
      }
      if ("reading" in dep) declaredInputs.add(dep.reading);
    }
    for (const [basis, scoped] of Object.entries(exempt.perBasis ?? {})) {
      for (const rule of ["horizon", "band"] as const) {
        for (const [input, reason] of Object.entries(scoped?.[rule] ?? {})) {
          requireReason(
            rule,
            reason,
            ` for ${input} on the ${basis} basis`,
            true,
          );
          /*
           * An opt-out naming an input the model never declared is the failure
           * this layer introduces: it reads as a reviewed decision, exempts
           * nothing, and goes on reading that way after the dep it was written
           * for is renamed or dropped.
           */
          if (!declaredInputs.has(input)) {
            throw new Error(
              `registerReckoner("${topic}", "${owner}"): the ${rule} exemption on the ${basis} basis names "${input}", which is not one of this model's declared inputs.\n\n` +
                `Declared: ${[...declaredInputs].sort().join(", ") || "(none)"}\n` +
                "An exemption can only be from an input the model actually takes. One naming anything else exempts nothing and reads as a decision somebody made.",
            );
          }
        }
      }
    }
  }
  const byOwner =
    reckoners.get(topic) ?? new Map<string, AnyReckonerDefinition>();
  byOwner.set(owner, reckoner);
  reckoners.set(topic, byOwner);
}

/**
 * One model's declared opt-out from one input rule, and who declared it. Useful
 * for listing the exceptions to the input rules in one place. Returned by
 * {@link getReckonerExemptions}.
 */
export interface ReckonerExemption {
  readonly topic: string;
  readonly owner: string;
  readonly rule: ReckonerInputRule;
  readonly reason: string;
  /** Present where the opt-out is narrowed to models produced on one basis. */
  readonly basis?: string;
  /** Present where it is narrowed to one declared input, which is the honest form. */
  readonly input?: string;
}

/**
 * Every input-rule opt-out any registered model declared, sorted by topic, then
 * owner, then rule. Useful for reviewing the exceptions to the input rules in one
 * place, since a model gets the rules without writing anything and only its
 * exceptions need reading. Used by the Uplink page generator.
 *
 * The ledger suite pins the whole set so a new exemption arrives as a reviewed
 * diff. The order is fixed because a generated page whose rows depend on module
 * import order changes on every bundler change.
 */
export function getReckonerExemptions(): ReckonerExemption[] {
  const rows: ReckonerExemption[] = [];
  for (const [topic, byOwner] of reckoners) {
    for (const [owner, definition] of byOwner) {
      const exempt = definition.exempt;
      if (!exempt) continue;
      if (exempt.horizon !== undefined) {
        rows.push({ topic, owner, rule: "horizon", reason: exempt.horizon });
      }
      if (exempt.band !== undefined) {
        rows.push({ topic, owner, rule: "band", reason: exempt.band });
      }
      /*
       * The narrowed form, listed with the rest: a reviewable set that silently
       * omitted it would report "no exemptions" while one was declared, which
       * is the inert-rule shape this whole mechanism exists to avoid.
       */
      for (const [basis, scoped] of Object.entries(exempt.perBasis ?? {})) {
        for (const rule of ["horizon", "band"] as const) {
          for (const [input, reason] of Object.entries(scoped?.[rule] ?? {})) {
            rows.push({ topic, owner, rule, reason, basis, input });
          }
        }
      }
    }
  }
  return rows.sort(
    (a, b) =>
      a.topic.localeCompare(b.topic) ||
      a.owner.localeCompare(b.owner) ||
      a.rule.localeCompare(b.rule),
  );
}

/**
 * The elected model for a topic, and which owner it belongs to. Useful for
 * knowing whose forward model is carrying a reading. Returned by
 * {@link getReckoner}.
 */
export interface ElectedReckoner {
  readonly owner: string;
  readonly definition: AnyReckonerDefinition;
}

/**
 * The model to use for `topic`, and who owns it, or `undefined` when none is
 * elected. Useful for carrying a reading forward past its last sample. Used by
 * the timeline store.
 *
 * The election order is: the sole non-core owner (an Uplink that owns the physics
 * beats the vanilla), else core's own registration (which is what a contest falls
 * back to, and what an uncontested core-only topic uses), else nothing. A contest
 * that core cannot cover answers with nothing, and `TimelineStore` reports that as
 * `declined: { reason: "contested" }`.
 *
 * {@link getReckonerConflicts} names every contested topic.
 */
export function getReckoner(topic: string): ElectedReckoner | undefined {
  const byOwner = reckoners.get(topic);
  if (!byOwner || byOwner.size === 0) return undefined;
  const contenders = [...byOwner.entries()].filter(
    ([owner]) => owner !== CORE_RECKONER_OWNER,
  );
  if (contenders.length === 1) {
    const [owner, definition] = contenders[0];
    return { owner, definition };
  }
  const core = byOwner.get(CORE_RECKONER_OWNER);
  return core ? { owner: CORE_RECKONER_OWNER, definition: core } : undefined;
}

/**
 * A topic two or more non-core owners have both registered a model for. Useful
 * for telling the operator which Uplinks disagree. Returned by
 * {@link getReckonerConflicts}.
 */
export interface ReckonerConflict {
  topic: string;
  /**
   * The competing owners, sorted, core included where it also registered. Every
   * contender is withheld; core is not a contender and covers where it has a
   * model. See {@link getReckoner}.
   */
  owners: string[];
}

/**
 * Every contested topic in the registry. Useful for telling the operator which
 * Uplinks disagree about a model. Used by the timeline store and the contributed
 * channels list. Mirrors `getReplacementConflicts`, and an empty result is the
 * normal case.
 *
 * Core is not counted as a party to the contest. Core ships a vanilla for every
 * marked Topic, so an Uplink electing itself over the vanilla is the intended
 * case, which {@link getReckoner} serves without hesitating. A contest is two
 * owners who both think they own the physics.
 */
export function getReckonerConflicts(): ReckonerConflict[] {
  const conflicts: ReckonerConflict[] = [];
  for (const [topic, byOwner] of reckoners) {
    const contenders = [...byOwner.keys()].filter(
      (owner) => owner !== CORE_RECKONER_OWNER,
    );
    if (contenders.length >= 2) {
      conflicts.push({ topic, owners: [...byOwner.keys()].sort() });
    }
  }
  return conflicts;
}

/**
 * Every topic anyone has registered a model for, with its owners. Useful for
 * listing everything one Uplink models, which {@link getReckoner} and
 * {@link getReckonerConflicts} cannot answer. Used by the contributed channels
 * list and the Uplink page generator. Sorted by topic so a generated page's
 * ordering does not depend on module import order.
 */
export function getReckonedTopics(): { topic: string; owners: string[] }[] {
  return [...reckoners.entries()]
    .map(([topic, byOwner]) => ({ topic, owners: [...byOwner.keys()].sort() }))
    .sort((a, b) => a.topic.localeCompare(b.topic));
}

/** Test-only: reset the registry to empty. */
export function clearReckoners(): void {
  reckoners.clear();
}
