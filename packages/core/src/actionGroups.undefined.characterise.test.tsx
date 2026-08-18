import type { ActionGroupStatePayload } from "@ksp-gonogo/sitrep-client";
import {
  StubTransport,
  TelemetryClient,
  TelemetryProvider,
} from "@ksp-gonogo/sitrep-client";
import { act, renderHook, waitFor } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  STOCK_ACTION_GROUPS,
  useActionGroup,
  useActionGroupFrom,
  useActionGroups,
  useActionGroupsFrom,
} from "./actionGroups";
import { clearRegistry } from "./registry";

/**
 * CHARACTERISATION: what the action-group registry yields TODAY when
 * `vessel.control` is `undefined`, and what it FABRICATES to stay operable.
 *
 * Two absence gates carry the whole behaviour:
 *   - `control?.actionGroups` then `named ?? []` in `useActionGroupsFrom`
 *   - `if (!id) return undefined` then the `/^AG(\d+)$/` fallback in
 *     `resolveActionGroup`
 *
 * The second one is the dangerous one: with no telemetry at all, asking for
 * `AG1` still hands back a FULLY OPERABLE toggle pill bound to `f.ag1`. That
 * is a control the operator can fire against a vessel we have heard nothing
 * from. Pinned here so the migration has to decide about it on purpose.
 */

type LooseControl =
  | { actionGroups?: ActionGroupStatePayload[] | null }
  | undefined;

function mountedWrapper(transport: StubTransport) {
  const client = new TelemetryClient(transport);
  return ({ children }: { children: ReactNode }) => (
    <TelemetryProvider client={client} carriedChannels={["vessel.control"]}>
      {children}
    </TelemetryProvider>
  );
}

beforeEach(() => clearRegistry());

describe("useActionGroups characterisation: nothing has arrived at all", () => {
  it("yields exactly the eight stock groups with no provider mounted", () => {
    const { result } = renderHook(() => useActionGroups());

    // Pins the `control?.actionGroups` + `named ?? []` gates firing: the
    // customs half is empty, the stock half is untouched. Named explicitly
    // rather than by count, so a change to either half is visible.
    expect(result.current.map((g) => g.name)).toEqual([
      "SAS",
      "RCS",
      "Light",
      "Gear",
      "Brake",
      "Abort",
      "Precision Control",
      "Stage",
    ]);
    expect(result.current).toHaveLength(STOCK_ACTION_GROUPS.length);
    // No entry carries an `index`: every one of these is stock, none is a
    // fabricated custom.
    expect(result.current.every((g) => g.index === undefined)).toBe(true);
  });

  it("yields the same eight with a provider mounted and vessel.control subscribed but silent", () => {
    const transport = new StubTransport();
    const { result } = renderHook(() => useActionGroups(), {
      wrapper: mountedWrapper(transport),
    });

    expect(transport.isSubscribed("vessel.control")).toBe(true);
    // Waiting-for-telemetry and no-stream-mounted render identically today.
    expect(result.current.map((g) => g.name)).toEqual(
      STOCK_ACTION_GROUPS.map((g) => g.name),
    );
  });

  it("keeps the stock half operable while the customs half is unknown", () => {
    const { result } = renderHook(() => useActionGroups());

    // SAS keeps its toggle with zero telemetry: the "degrade to stock works,
    // customs pending" behaviour the module's doc claims.
    expect(result.current.find((g) => g.name === "SAS")?.toggle).toBe("f.sas");
    // Precision Control is the one stock entry with no toggle, absence of a
    // toggle here is a DESIGN decision and not a missing-telemetry symptom.
    expect(
      result.current.find((g) => g.name === "Precision Control")?.toggle,
    ).toBeNull();
  });
});

describe("useActionGroupsFrom characterisation: absent record vs absent field vs tombstone", () => {
  /**
   * The three shapes are NOT distinguished. `undefined` (no record),
   * `{}` (record arrived, field missing) and `{ actionGroups: null }` (the
   * backend confirming it has no action-group data this tick) all take the
   * same `named ?? []` path and produce byte-identical registries.
   */
  it("produces an identical registry for undefined, a fieldless record, and an explicit null", () => {
    const absent = renderHook(() => useActionGroupsFrom(undefined));
    const fieldless = renderHook(() => useActionGroupsFrom({}));
    const tombstone = renderHook(() =>
      useActionGroupsFrom({ actionGroups: null }),
    );

    expect(absent.result.current).toEqual(fieldless.result.current);
    expect(fieldless.result.current).toEqual(tombstone.result.current);
    expect(absent.result.current).toHaveLength(STOCK_ACTION_GROUPS.length);
  });

  /**
   * An empty ARRAY is also the same answer, and that one genuinely means
   * something different ("the backend reported zero custom groups"). Four
   * distinct wire states, one render.
   */
  it("produces the same registry for a confirmed empty custom list", () => {
    const { result } = renderHook(() =>
      useActionGroupsFrom({ actionGroups: [] }),
    );

    expect(result.current).toHaveLength(STOCK_ACTION_GROUPS.length);
  });

  /**
   * Partial payload WITHIN an entry: `customActionGroup`'s `name ?? \`AG${index}\``
   * invents a stock-style label for a named-group entry whose name did not
   * arrive. So an AGX group with a dropped name reads as a stock AG pill.
   */
  it("invents an AG{index} label for a custom entry whose name field is undefined", () => {
    const partial = [
      { index: 4, state: false },
    ] as unknown as ActionGroupStatePayload[];
    const { result } = renderHook(() =>
      useActionGroupsFrom({ actionGroups: partial }),
    );

    const custom = result.current.at(-1);
    expect(custom).toEqual({
      name: "AG4",
      toggle: "f.ag4",
      description: "Custom action group 4",
      index: 4,
    });
  });

  /** An entry whose index is undefined fabricates the string "AGundefined". */
  it("fabricates AGundefined and f.agundefined for an entry with no index", () => {
    const partial = [
      { name: undefined, state: true },
    ] as unknown as ActionGroupStatePayload[];
    const { result } = renderHook(() =>
      useActionGroupsFrom({ actionGroups: partial }),
    );

    // Pinned as-observed, not as-desired: this pill would dispatch a bogus
    // `f.agundefined` command.
    expect(result.current.at(-1)).toMatchObject({
      name: "AGundefined",
      toggle: "f.agundefined",
    });
  });

  /**
   * The `useMemo` is keyed on `named`, so an absent read does NOT churn the
   * registry identity across re-renders. Worth pinning: a migration that
   * hands this hook a freshly-built object every frame would silently turn
   * every consumer into a per-frame re-render.
   */
  it("keeps the same array identity across re-renders while the read stays absent", () => {
    const { result, rerender } = renderHook(
      (props: { control: LooseControl }) => useActionGroupsFrom(props.control),
      { initialProps: { control: undefined as LooseControl } },
    );

    const first = result.current;
    rerender({ control: undefined });
    expect(result.current).toBe(first);
  });
});

describe("useActionGroup characterisation: resolving a configured id against an empty registry", () => {
  /**
   * THE HIGH-VALUE ONE. With zero telemetry, `AG1` resolves to a complete,
   * clickable toggle bound to `f.ag1`. Nothing in the returned descriptor
   * records that it was synthesised rather than reported.
   */
  it("synthesises a fully operable AG1 toggle from no telemetry whatsoever", () => {
    const { result } = renderHook(() => useActionGroup("AG1"));

    expect(result.current).toEqual({
      name: "AG1",
      toggle: "f.ag1",
      description: "Custom action group 1",
      index: 1,
    });
  });

  it("synthesises any AG{n}, including indices no stock backend reports", () => {
    const { result } = renderHook(() => useActionGroup("AG240"));

    // Stock tops out at ten. 240 only exists under AGX, and this resolves
    // just as confidently with AGX absent and no telemetry at all.
    expect(result.current).toEqual({
      name: "AG240",
      toggle: "f.ag240",
      description: "Custom action group 240",
      index: 240,
    });
  });

  /**
   * A non-AG id (an AGX display name) degrades to a read-only pill instead:
   * present, named, `toggle: null`, and carrying NO index. This is the
   * deliberately-inert half of the fallback.
   */
  it("degrades a non-AG configured name to a read-only pill with no index", () => {
    const { result } = renderHook(() => useActionGroup("Deploy Solar"));

    expect(result.current).toEqual({
      name: "Deploy Solar",
      toggle: null,
      description: "Deploy Solar",
    });
    expect(result.current?.index).toBeUndefined();
  });

  /**
   * `if (!id) return undefined` is the ONLY route to `undefined`, and it is
   * driven by CONFIG, never by telemetry. So "No action group configured" can
   * never be caused by absent telemetry, which is the property the fallback
   * exists to guarantee.
   */
  it("returns undefined only for an unconfigured id, never for absent telemetry", () => {
    expect(
      renderHook(() => useActionGroup(undefined)).result.current,
    ).toBeUndefined();
    // The empty string hits the same falsy gate as undefined.
    expect(renderHook(() => useActionGroup("")).result.current).toBeUndefined();
    // Any non-empty id resolves to something, telemetry or not.
    expect(
      renderHook(() => useActionGroup("AG1")).result.current,
    ).toBeDefined();
    expect(
      renderHook(() => useActionGroup("nonsense")).result.current,
    ).toBeDefined();
  });

  it("resolves a stock name off the literal with no telemetry", () => {
    const { result } = renderHook(() => useActionGroup("Gear"));

    expect(result.current).toEqual({
      name: "Gear",
      toggle: "f.gear",
      description: "Gear state",
    });
  });

  /**
   * The fabricated AG1 is INDISTINGUISHABLE from the reported one. Nothing on
   * the descriptor says which it is, so a widget cannot caveat the pill it
   * renders from no telemetry. The registry length is the only observable
   * difference, and no consumer of `useActionGroup` sees it.
   */
  it("hands back a descriptor identical to the reported one, so fabricated and reported cannot be told apart", async () => {
    const transport = new StubTransport();
    const { result } = renderHook(
      () => ({ one: useActionGroup("AG1"), all: useActionGroups() }),
      { wrapper: mountedWrapper(transport) },
    );

    const fabricated = result.current.one;
    expect(result.current.all).toHaveLength(STOCK_ACTION_GROUPS.length);

    act(() =>
      transport.emit("vessel.control", {
        sasMode: 0,
        actionGroups: [{ index: 1, name: "AG1", state: true }],
      }),
    );
    // The registry grew, proving the sample landed.
    await waitFor(() =>
      expect(result.current.all).toHaveLength(STOCK_ACTION_GROUPS.length + 1),
    );
    // And the descriptor did not change at all.
    expect(result.current.one).toEqual(fabricated);
  });
});

describe("useActionGroupFrom characterisation: the no-duplicate-subscription variant", () => {
  /** Same fabrication as `useActionGroup`, reached without any telemetry read. */
  it("synthesises AG1 from an undefined control payload", () => {
    const { result } = renderHook(() => useActionGroupFrom(undefined, "AG1"));

    expect(result.current).toEqual({
      name: "AG1",
      toggle: "f.ag1",
      description: "Custom action group 1",
      index: 1,
    });
  });

  it("returns undefined for an unconfigured id even with a full control payload", () => {
    const { result } = renderHook(() =>
      useActionGroupFrom(
        { actionGroups: [{ index: 1, name: "AG1", state: true }] },
        undefined,
      ),
    );

    expect(result.current).toBeUndefined();
  });

  /**
   * A tombstoned custom list still resolves the configured id, by fabrication.
   * This is the "saved AGX group after AGX is uninstalled" case the module's
   * doc names, and it renders identically to the pending case.
   */
  it("still fabricates AG3 when the control payload explicitly reports null customs", () => {
    const tombstone = renderHook(() =>
      useActionGroupFrom({ actionGroups: null }, "AG3"),
    );
    const pending = renderHook(() => useActionGroupFrom(undefined, "AG3"));

    expect(tombstone.result.current).toEqual(pending.result.current);
    expect(tombstone.result.current?.toggle).toBe("f.ag3");
  });
});
