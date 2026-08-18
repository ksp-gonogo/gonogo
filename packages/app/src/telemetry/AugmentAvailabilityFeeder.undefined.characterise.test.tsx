import { AugmentSlot, clearAugments, registerAugment } from "@ksp-gonogo/core";
import type { TopicId } from "@ksp-gonogo/sitrep-sdk";
import { act, cleanup, render, screen } from "@ksp-gonogo/test-utils";
import {
  createDomainAvailabilityStore,
  DomainAvailabilityContext,
  type DomainAvailabilityStore,
} from "@ksp-gonogo/ui-kit";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { AugmentAvailabilityFeeder } from "./AugmentAvailabilityFeeder";

/**
 * What `AugmentAvailabilityFeeder` DOES today when `<domain>.available` reads
 * `undefined`, recorded before `useTelemetry` starts returning a `Reading`.
 *
 * The entire component is one absence test used as a positive fact:
 * `store.setAvailable(domain, value !== undefined)`. It is PRESENCE, not truth
 * and not content, and that is deliberate per its own doc ("a Domain is
 * available while ANY value has arrived"). So `undefined` here carries the
 * whole meaning of "this Uplink's Domain is not installed", and everything an
 * augment does or does not draw hangs off it.
 *
 * The store is injected rather than provided by `DomainAvailabilityProvider`, so
 * a test can read the written boolean directly instead of inferring it from what
 * an augment happened to render.
 */

const SLOT = "characterise-availability.slot";
const DOMAIN = "demomod";

function seedAugments() {
  registerAugment({
    id: "gated-overlay",
    augments: SLOT,
    component: () => <div>gated-overlay</div>,
    requires: DOMAIN,
    channels: [`${DOMAIN}.available` as TopicId],
  });
  // Ungated, so it renders whatever the store says. A witness that the slot
  // itself is composing: without it, "the gated augment is absent" would also
  // pass if the slot were broken or never mounted.
  registerAugment({
    id: "ungated-overlay",
    augments: SLOT,
    component: () => <div>ungated-overlay</div>,
  });
}

function mount(store: DomainAvailabilityStore | null) {
  const fixture = setupStreamFixture({
    carriedChannels: [`${DOMAIN}.available`],
    pinnedUt: 10,
  });
  const view = render(
    <fixture.Provider>
      <DomainAvailabilityContext.Provider value={store}>
        <AugmentAvailabilityFeeder />
        <AugmentSlot name={SLOT} props={{}} />
      </DomainAvailabilityContext.Provider>
    </fixture.Provider>,
  );
  return {
    ...fixture,
    ...view,
    emitAvailable: (payload: unknown) => {
      act(() => {
        fixture.emit(`${DOMAIN}.available`, payload);
        fixture.store.beginFrame();
      });
    },
  };
}

afterEach(() => {
  cleanup();
  clearAugments();
});

describe("AugmentAvailabilityFeeder: what undefined means for <domain>.available today", () => {
  it("writes an explicit false for a Domain that has said nothing, and the gated augment is withheld", () => {
    seedAugments();
    const store = createDomainAvailabilityStore();
    // Seeded true first, because `isAvailable` answers `false` for a Domain
    // nothing ever wrote: without the seed this test could not tell a written
    // false from an absent entry, which is the whole claim.
    store.setAvailable(DOMAIN, true);
    const fixture = mount(store);

    // The written boolean, not an inference from the render: nothing has
    // arrived, so the feeder states the Domain is unavailable. "Waiting for
    // telemetry" and "this Uplink is not installed" are the same value here.
    expect(store.isAvailable(DOMAIN)).toBe(false);
    expect(fixture.transport.isSubscribed(`${DOMAIN}.available`)).toBe(true);
    expect(screen.queryByText("gated-overlay")).toBeNull();
    expect(screen.getByText("ungated-overlay")).toBeInTheDocument();

    fixture.unmount();
  });

  it("marks the Domain available on a payload that says available: false", () => {
    seedAugments();
    const store = createDomainAvailabilityStore();
    const fixture = mount(store);

    // The gate reads arrival, never content. A Domain reporting itself NOT
    // available is therefore recorded as available, and its augment renders.
    // Pinned because it is the sharpest statement of what this site means by
    // `undefined`: absence of a record, and nothing else.
    fixture.emitAvailable({ available: false });

    expect(store.isAvailable(DOMAIN)).toBe(true);
    expect(screen.getByText("gated-overlay")).toBeInTheDocument();

    fixture.unmount();
  });

  /**
   * Recorded prior behaviour: "marks the Domain available on a confirmed tombstone,
   * because null is not undefined". Recorded as an inversion and not endorsed, and it
   * turns out to be the right answer reached by the wrong route: a producer saying
   * "there is no value" is still a producer, so the domain IS installed. The gate is
   * now `state !== "pending"`, which says that on purpose.
   */
  it("marks the Domain available on a confirmed tombstone: a producer saying nothing-here is still a producer", () => {
    seedAugments();
    const store = createDomainAvailabilityStore();
    const fixture = mount(store);

    expect(store.isAvailable(DOMAIN)).toBe(false);

    // `null` is the store's confirmed absence. The domain answered, so the Uplink
    // is installed and the augment composes in; what it has to SAY about the domain
    // is a separate question from whether it is there.
    fixture.emitAvailable(null);

    expect(store.isAvailable(DOMAIN)).toBe(true);
    expect(screen.getByText("gated-overlay")).toBeInTheDocument();

    fixture.unmount();
  });

  it("revokes availability when the watch unmounts, not when the value goes away", () => {
    seedAugments();
    const store = createDomainAvailabilityStore();
    const fixture = mount(store);

    fixture.emitAvailable({ available: true });
    expect(store.isAvailable(DOMAIN)).toBe(true);

    // There is no path back to `undefined` for a topic that has arrived: the
    // effect cleanup is the only writer of `false` after the first write, so
    // unmounting is what revokes, and a Domain that goes silent mid-mission
    // stays available.
    fixture.unmount();
    expect(store.isAvailable(DOMAIN)).toBe(false);
  });

  it("writes nowhere with no availability store above it, so a live Domain still gates its augment out", () => {
    seedAugments();
    // `if (!store) return null` means the feeder mounts no watches at all: the
    // absence of the store, like the absence of a value, reads as unavailable.
    const fixture = mount(null);

    // No watch exists to subscribe, so the Domain's Topic is never even asked
    // for: that is the specific, observable shape of "renders nothing" here.
    expect(fixture.transport.isSubscribed(`${DOMAIN}.available`)).toBe(false);
    fixture.emitAvailable({ available: true });

    expect(screen.queryByText("gated-overlay")).toBeNull();
    expect(screen.getByText("ungated-overlay")).toBeInTheDocument();

    fixture.unmount();
  });
});
