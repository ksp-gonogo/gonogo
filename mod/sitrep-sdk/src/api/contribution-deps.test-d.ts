import type { Reading, TopicCurrency } from "../reading";
import { defineUplinkClient } from "../spine/uplink-clients";
import type { TopicPayload } from "../topics";

/**
 * A contribution's `compute` is typed from the contribution's OWN `deps`, which
 * are also the only Topics the aggregation feeds it. A slot declares its entry
 * and nothing about the data a contributor reads.
 *
 * <para>Every assertion in this file would compile whether or not the typing
 * works, so none of the checks below is an assertion: each is either a real
 * assignment to a precise type, or a `@ts-expect-error` that FAILS THE BUILD if
 * the error it names stops happening.</para>
 */
const CLIENT = defineUplinkClient({
  id: "typetest",
  version: "0.0.1",
  name: "Type test",
  description: "Typing checks for contributions.",
});

CLIENT.registerContribution({
  id: "declared-topic-is-precise",
  contributes: "crew-status.row-tone",
  deps: ["career.status"],
  compute: (topics) => {
    // A declared dep arrives as its reading, typed by its real payload.
    const status = topics["career.status"];
    const funds: number | undefined =
      status.state === "observed"
        ? status.value.balances?.funds?.magnitude
        : undefined;
    void funds;
    // @ts-expect-error a topic nobody declared is not readable at all
    void topics["vessel.flight"];
    // @ts-expect-error and neither is a misspelling of one that was declared
    void topics["career.stats"];
    return [];
  },
});

CLIENT.registerContribution({
  id: "slot-names-no-topics",
  contributes: "crew-status.row-tone",
  compute: (topics) => {
    // @ts-expect-error a slot feeds nothing, so a contribution with no deps reads nothing
    void topics["vessel.crew"];
    return [];
  },
});

type CareerStatus = TopicPayload<"career.status">;

CLIENT.registerContribution({
  id: "a-topic-is-its-reading",
  contributes: "crew-status.row-tone",
  deps: ["career.status"],
  compute: (topics) => {
    const status: TopicCurrency<CareerStatus, { readonly status: "none" }> =
      topics["career.status"];
    // @ts-expect-error the payload is reached only through a state that carries one, so a held value cannot pass for a current one
    const payload: CareerStatus | null | undefined = topics["career.status"];
    // @ts-expect-error nor through a field of the reading, which would read as the payload's own field
    void topics["career.status"].balances;
    // @ts-expect-error a contribution's reading carries no forward model
    const modelled: "available" = status.reckoning.status;
    void [status, payload, modelled];
    return [];
  },
});

CLIENT.registerContribution({
  id: "no-second-spelling",
  contributes: "crew-status.row-tone",
  // @ts-expect-error every Topic dep is already a reading, so there is no `{ reading }` form to ask for one
  deps: [{ reading: "vessel.crew" }],
  compute: () => [],
});

const BARE = CLIENT.registerProcessor({
  id: "derived",
  deps: ["career.status"],
  compute: () => ({ tally: 1 }),
});

CLIENT.registerContribution({
  id: "undated-processor-refused",
  contributes: "crew-status.row-tone",
  // @ts-expect-error a processor reading only bare Topics answers with no currency, so a contribution cannot depend on it
  deps: [BARE],
  compute: () => [],
});

const DATED = CLIENT.registerProcessor({
  id: "dated",
  deps: [{ reading: "career.status" }],
  compute: () => ({ tally: 1 }),
});

CLIENT.registerContribution({
  id: "processor-result-is-precise",
  contributes: "crew-status.row-tone",
  deps: [DATED],
  compute: (topics) => {
    // A Processor dep arrives under its stamped id as a reading of its result, dated by its own reading deps.
    const derived: Reading<{ tally: number }> | undefined = topics[DATED.id];
    void derived;
    // @ts-expect-error a processor dep must not reopen the whole record
    void topics["vessel.flight"];
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
