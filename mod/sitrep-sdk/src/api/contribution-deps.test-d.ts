import { defineUplinkClient } from "../spine/uplink-clients";

/**
 * A contribution's `compute` is typed from the contribution's OWN `deps`, not
 * from the slot's declared topics.
 *
 * <para>The slot half was never able to type an Uplink reading its own channel:
 * a slot declares the core topics every contributor can rely on and deliberately
 * names no mod's topics, so a mod-owned channel could only ever arrive as
 * `unknown` through an `& Record<string, unknown>` tail. That tail made every key
 * readable, which is why eleven contributions across five Uplinks were reading
 * topics nothing had declared, each paying an assertion to get back the type it
 * already knew.</para>
 *
 * <para>Every assertion in this file would compile whether or not the typing
 * works, so none of the checks below is an assertion: each is either a real
 * assignment to a precise type, or a `@ts-expect-error` that FAILS THE BUILD if
 * the error it names stops happening. A test that cannot fail is the failure
 * mode this seam already had once.</para>
 */
const CLIENT = defineUplinkClient({
  id: "typetest",
  version: "0.0.1",
  name: "Type test",
});

CLIENT.registerContribution({
  id: "declared-topic-is-precise",
  contributes: "crew-status.row-tone",
  deps: ["career.status"],
  compute: (topics) => {
    // A declared dep arrives with its real payload type, no assertion needed.
    const funds: number | undefined =
      topics["career.status"]?.economy?.funds?.magnitude;
    void funds;
    // @ts-expect-error a topic nobody declared is not readable at all
    void topics["vessel.state"];
    // @ts-expect-error and neither is a misspelling of one that was declared
    void topics["career.stats"];
    return [];
  },
});

CLIENT.registerContribution({
  id: "slot-topics-still-guaranteed",
  contributes: "crew-status.row-tone",
  compute: (topics) => {
    // The slot's own declaration still stands on its own: `crew-status.row-tone`
    // guarantees `vessel.crew` to every contributor, deps or no deps.
    void topics["vessel.crew"];
    return [];
  },
});

const PROCESSOR = CLIENT.registerProcessor({
  id: "derived",
  deps: ["career.status"],
  compute: () => ({ tally: 1 }),
});

CLIENT.registerContribution({
  id: "processor-result-is-precise",
  contributes: "crew-status.row-tone",
  deps: [PROCESSOR],
  compute: (topics) => {
    // A Processor dep arrives under its stamped id, typed by the handle's brand
    // rather than as `unknown`. This is the read the `Record<string, unknown>`
    // tail used to exist for.
    const derived: { tally: number } | undefined = topics[PROCESSOR.id];
    void derived;
    // @ts-expect-error a processor dep must not reopen the whole record
    void topics["vessel.state"];
    return [];
  },
});

/**
 * The one way left to read loosely, named rather than wished away.
 *
 * <para>`AnyContribution` is the registry's STORAGE type: slot and dep tuple
 * erased, `compute` taking an open record, which is the honest signature for a
 * value fished out of a string-keyed map. It is also still structurally
 * registrable, so an author who deliberately annotates their own definition with
 * it gets the old loose reads back. That is an opt-out that costs an import and
 * an annotation, not the silent default the `& Record<string, unknown>` tail
 * was, and nothing in the tree authors a contribution that way: every use of
 * this type is a registry read.</para>
 *
 * <para>Asserted rather than forbidden because forbidding it means branding the
 * type the registry itself round-trips through, and a gate that breaks the
 * registry to close an unused door is a worse trade. If a contribution ever DOES
 * appear annotated this way, this is the comment that says it was a choice.</para>
 */
import type { AnyContribution } from "./types";

declare const erased: AnyContribution;
CLIENT.registerContribution(erased);
