import { afterEach, describe, expect, it } from "vitest";
import { clearAugments, getAugments, registerAugment } from "./augments";

/**
 * Two loaded copies of this module must share ONE augment registry, because an
 * Uplink that inlines ui-kit registers into its own copy while the dashboard
 * reads the app's. A distinct import query makes Vite instantiate the file a
 * second time, which is the same divergence a duplicated package produces.
 */
const SECOND_COPY_SPECIFIER = "./augments?second-copy";

async function secondCopy(): Promise<typeof import("./augments")> {
  return (await import(SECOND_COPY_SPECIFIER)) as typeof import("./augments");
}

const STUB = { id: "second-copy-probe", augments: "probe.slot" } as const;

describe("the augment registry across two copies of the module", () => {
  afterEach(async () => {
    clearAugments();
    (await secondCopy()).clearAugments();
  });

  it("is a different module instance, so the test is arranging what it claims", async () => {
    expect((await secondCopy()).registerAugment).not.toBe(registerAugment);
  });

  it("shows this copy's registration to the other one", async () => {
    registerAugment({ ...STUB, component: () => null });

    expect((await secondCopy()).getAugments().map((a) => a.id)).toContain(
      STUB.id,
    );
  });

  it("shows the other copy's registration to this one", async () => {
    (await secondCopy()).registerAugment({ ...STUB, component: () => null });

    expect(getAugments().map((a) => a.id)).toContain(STUB.id);
  });

  it("clears both copies from either side", async () => {
    (await secondCopy()).registerAugment({ ...STUB, component: () => null });
    clearAugments();

    expect((await secondCopy()).getAugments()).toEqual([]);
  });
});
