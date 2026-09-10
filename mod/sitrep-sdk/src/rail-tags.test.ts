import { describe, expect, it } from "vitest";
import {
  GENERATED_COMMAND_IDS,
  GENERATED_COMMAND_RAIL,
} from "./__generated__/command-map";
import { GENERATED_TOPIC_IDS } from "./__generated__/topic-map";
import { commandRail, registerUplinkCommand } from "./commands";
import {
  railTagsForCommand,
  railTagsForControlAxis,
  railTagsForTelemetry,
  railTagsFromCommandRail,
  UNDECLARED_COMMAND_RAIL_TAGS,
} from "./rail-tags";

/**
 * The generated table carries what a client must READ about a command rather
 * than assume, which is now one column. Continuity left it: it was a `Set` in
 * `spine/map-command.ts` holding one id, then a declaration on that same id
 * saying the same thing, and both were answering the wrong question. See
 * `railTagsForControlAxis` below for the one the producer answers instead.
 */
describe("the generated rail table", () => {
  it("carries a row for every declared command", () => {
    const missing = GENERATED_COMMAND_IDS.filter(
      (id) => commandRail(id) === null,
    );
    expect(missing).toEqual([]);
    // A count, because an empty `missing` over an empty id list would read as a
    // clean pass while the table said nothing at all.
    expect(GENERATED_COMMAND_IDS.length).toBeGreaterThan(40);
  });

  /*
   * `replies` reads true on every row, and that is a finding rather than a
   * placeholder: `Sitrep.Contract/CommandResult.cs` rules that results are
   * always delivered, never a fire-and-forget void. Asserted so the day a
   * command is declared that answers nothing, this says so here rather than
   * downstream in a rail that quietly stopped drawing its return leg.
   */
  it("says every declared command answers, which the contract requires", () => {
    const unacked = Object.entries(GENERATED_COMMAND_RAIL)
      .filter(([, rail]) => !rail.replies)
      .map(([id]) => id);
    expect(unacked).toEqual([]);
  });
});

/**
 * DIRECTION is decidable from the contract, which is what lets there be one
 * derivation per direction instead of a judgement call at each call site: a
 * declared command id is a command and a Topic id is telemetry, and no id is
 * both.
 *
 * Asserted rather than assumed, because the two derivations would both answer
 * about the same id if the two namespaces ever met, and each would answer
 * differently.
 */
describe("the two namespaces the two derivations read", () => {
  it("never names the same id a command and a Topic", () => {
    const topics = new Set<string>(GENERATED_TOPIC_IDS);
    expect(GENERATED_COMMAND_IDS.filter((id) => topics.has(id))).toEqual([]);
    // Both namespaces are non-empty, so an empty intersection is a fact about
    // them rather than about a list that failed to load.
    expect(topics.size).toBeGreaterThan(40);
    expect(GENERATED_COMMAND_IDS.length).toBeGreaterThan(40);
  });
});

describe("railTagsForCommand", () => {
  /*
   * The fly-by-wire override reads DISCRETE, like every other command, and it
   * is the one worth naming: it used to declare itself continuous, and the
   * Navball presses that same id to send a trim. A press is a point, so the
   * press got a ribbon it had no stream for and the rail drew nothing at all
   * (`PanelDelayRail.handleHasContent`). What is continuous is the axis, which
   * `railTagsForControlAxis` says and the command cannot.
   */
  it("reads the fly-by-wire override as a point, like every other command", () => {
    expect(railTagsForCommand("vessel.control.setAxes")).toEqual({
      direction: "command",
      continuity: "discrete",
      delivery: "acked",
    });
  });

  it("reads an ordinary command as a discrete acked point event", () => {
    expect(railTagsForCommand("vessel.control.stage")).toEqual({
      direction: "command",
      continuity: "discrete",
      delivery: "acked",
    });
  });

  /*
   * The finding this refactor turned up, pinned so it cannot drift back by
   * accident. A throttle looks continuous, and the rail drew it that way for as
   * long as the graph decided continuity by which array a datum arrived in. The
   * mod says otherwise: `KspVesselActuator.SetThrottle` sets a held global once
   * and the fly-by-wire override "writes every axis except this one", so ONE
   * dispatch of it is a point event. What is continuous is the AXIS a widget
   * holds, which is `railTagsForControlAxis`'s business below, not the command's.
   */
  it("reads setThrottle as discrete, because one dispatch of it is a point", () => {
    expect(railTagsForCommand("vessel.control.setThrottle").continuity).toBe(
      "discrete",
    );
  });

  /*
   * The derivation is now the SAME answer for every declared command, so assert
   * it over the whole table rather than on a sample: a row that somehow read
   * otherwise would be a column that came back.
   */
  it("reads every declared command the same way", () => {
    const odd = GENERATED_COMMAND_IDS.filter(
      (id) => railTagsForCommand(id) !== UNDECLARED_COMMAND_RAIL_TAGS,
    );
    expect(odd).toEqual([]);
    expect(GENERATED_COMMAND_IDS.length).toBeGreaterThan(40);
  });

  it("falls back to what the contract guarantees for an undeclared command", () => {
    expect(railTagsForCommand("nobody.declared.this")).toEqual(
      UNDECLARED_COMMAND_RAIL_TAGS,
    );
    // ACKED, not fire-and-forget: an id reaching the untyped overload still
    // gets a `CommandResult` back, and reading an absent row as "nothing
    // answers" would drop the return leg for every command dispatched by name.
    expect(UNDECLARED_COMMAND_RAIL_TAGS.delivery).toBe("acked");
  });

  /*
   * The other branch of the delivery derivation, which no declared command can
   * currently reach. Exercised on a planted row rather than left unreached: a
   * derivation whose second branch nothing runs is a derivation nobody has
   * checked, and the whole claim being made here is that delivery is READ
   * rather than assumed.
   */
  it("derives fire-and-forget from a row that answers nothing", () => {
    expect(railTagsFromCommandRail({ replies: false })).toEqual({
      direction: "command",
      continuity: "discrete",
      delivery: "fire-and-forget",
    });
  });
});

/**
 * The seam that replaced the hardcoded set, and the reason it had to be
 * replaced: an Uplink ships on its own schedule, so no list written in this
 * package can name its commands. It registers its own generated row at load and
 * the derivation reads it, with nothing in the SDK naming a token of that mod's.
 */
describe("an Uplink registering its own command", () => {
  it("gets a rail row from its own registration", () => {
    const id = "testuplink.science.transmit";
    // Before registration nothing is known about it, and the answer says so
    // rather than guessing.
    expect(commandRail(id)).toBeNull();

    registerUplinkCommand(id, { replies: true });

    expect(commandRail(id)).toEqual({ replies: true });
    expect(railTagsForCommand(id)).toEqual({
      direction: "command",
      continuity: "discrete",
      delivery: "acked",
    });
  });
});

/**
 * Identity stability, which is load-bearing and invisible. These triples ride on
 * values compared by SHALLOW equality: a command handle is a fresh literal on
 * most renders and the delay rail's store only notifies when a handle actually
 * moved, so a freshly-minted `tags` would make every handle look moved every
 * render and the rail would redraw at frame rate to show the same thing.
 *
 * Asserted with `toBe`, never `toEqual`: `toEqual` passes on two separate
 * objects with the same fields, which is exactly the regression.
 */
describe("the axis triples are interned", () => {
  it("hands back one instance per combination, across derivations", () => {
    expect(railTagsForCommand("vessel.control.stage")).toBe(
      railTagsForCommand("vessel.target.set"),
    );
    expect(railTagsForTelemetry("continuous")).toBe(
      railTagsForTelemetry("continuous"),
    );
    /*
     * Two held axes reached through the same derivation but keyed off different
     * write commands: both land on command/continuous/acked and must be the one
     * instance, since a widget holding several axes registers one handle per
     * axis and the store compares them shallowly.
     */
    expect(railTagsForControlAxis("vessel.control.setThrottle")).toBe(
      railTagsForControlAxis("vessel.control.setAxes"),
    );
  });

  it("still tells the combinations apart", () => {
    expect(railTagsForTelemetry("continuous")).not.toBe(
      railTagsForTelemetry("discrete"),
    );
  });

  it("hands back a frozen value, so no consumer can edit the shared one", () => {
    expect(Object.isFrozen(railTagsForTelemetry("continuous"))).toBe(true);
  });
});

describe("railTagsForTelemetry", () => {
  it("fixes direction and delivery and asks only for continuity", () => {
    expect(railTagsForTelemetry("continuous")).toEqual({
      direction: "telemetry",
      continuity: "continuous",
      delivery: "fire-and-forget",
    });
  });

  /*
   * The fourth row of the rail's table, a science result sent home. Declarable
   * with no new code, which is the property the refactor was for; whether
   * anything DRAWS it is ui-kit's renderer table's business, and today nothing
   * does (see `railTags.test.ts` there).
   */
  it("declares a discrete arrival with no new code path", () => {
    expect(railTagsForTelemetry("discrete")).toEqual({
      direction: "telemetry",
      continuity: "discrete",
      delivery: "fire-and-forget",
    });
  });
});

describe("railTagsForControlAxis", () => {
  it("is continuous, and the write command never says otherwise", () => {
    // Every command is discrete (asserted above); the held axis is not.
    expect(railTagsForControlAxis("vessel.control.setThrottle")).toEqual({
      direction: "command",
      continuity: "continuous",
      delivery: "acked",
    });
  });

  it("still reads delivery off the command", () => {
    expect(railTagsForControlAxis("vessel.control.setAxes").delivery).toBe(
      "acked",
    );
  });
});
