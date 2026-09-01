import { afterEach, describe, expect, it } from "vitest";
import { clearAugments, getAugments, registerAugment } from "./augments";

/**
 * Two loaded copies of this module must share ONE augment registry.
 *
 * `@ksp-gonogo/ui-kit` and `@ksp-gonogo/sitrep-sdk` both export
 * `registerAugment`, `getAugmentsForSlot` and `clearAugments`, and the sdk's
 * three are shims onto `getHost()`, so they reach whichever copy of this module
 * the APP linked. A widget that calls this module's copy directly reaches
 * whichever one its own bundle linked. While the state was a module-static
 * `Map`, those were the same object only for as long as exactly one copy of the
 * module was loaded, and an Uplink that inlines ui-kit instead of marking it
 * external loads a second: it registers into its own copy, the dashboard reads
 * the app's, and nothing reports an error at any point. `map-poi.ts` in the sdk
 * carries the same reasoning and reached the same fix before this did.
 *
 * A distinct import query is what a second copy looks like to Vite: the
 * specifier differs, so the module graph instantiates the file again, module
 * scope and all. That is the same divergence a duplicated package produces, in
 * the one form a test can arrange in-process.
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
