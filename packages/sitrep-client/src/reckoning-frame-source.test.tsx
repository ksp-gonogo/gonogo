import { render, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { TelemetryClient } from "./client";
import { TelemetryProvider, useTelemetryStore } from "./context";
import { StubTransport } from "./stub-transport";
import type { TimelineStore } from "./timeline-store";

/**
 * A frame has to arrive when NOTHING does.
 *
 * Every reckoning is a function of the frame's view time, and so is the horizon
 * a model withdraws at. The store handles that correctly: a frame minted with
 * no ingest re-derives the arm for that frame's view time
 * (`reckoning-gaps.test.ts` pins it). What did not, and is the reason this file
 * exists, is the frame SOURCE: `TelemetryProvider` drove `beginFrame` from
 * `client.subscribeStore`, which fires on INGEST, while `useViewUt` advances off
 * `requestAnimationFrame` regardless.
 *
 * So in the one situation the whole mechanism exists for, total loss of
 * contact, nothing arrives, no frame is minted, and the modelled value freezes
 * at the instant the last packet landed while the age rendered beside it keeps
 * climbing. "Stale for twenty minutes" next to a projection for second one. The
 * horizon could never fire either, since withdrawing needs a frame to withdraw
 * on.
 *
 * A frame per animation frame is also what `TimelineStore.beginFrame`'s own doc
 * asks for ("call once per animation frame / read cycle"); coalescing to ingest
 * was the optimisation, and it was wrong for a quiet link. It costs little:
 * `beginFrame` bumps a generation and clears a memo, derived channels re-derive
 * LAZILY on read, and `sampleReading`'s identity cache means a topic nobody
 * models hands back the same object and re-renders nothing.
 */

function StoreProbe({ onStore }: { onStore: (store: TimelineStore) => void }) {
  onStore(useTelemetryStore());
  return null;
}

describe("the frame source", () => {
  it("mints frames while the link is quiet, so a reckoning can advance", async () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    let store: TimelineStore | undefined;

    render(
      <TelemetryProvider client={client}>
        <StoreProbe
          onStore={(s) => {
            store = s;
          }}
        />
      </TelemetryProvider>,
    );

    await waitFor(() => expect(store).toBeDefined());
    const first = store?.currentFrame().generation ?? -1;

    // Nothing is ingested, subscribed or emitted. The only thing that happens
    // is time passing.
    await waitFor(
      () => {
        expect(store?.currentFrame().generation ?? -1).toBeGreaterThan(first);
      },
      { timeout: 2000 },
    );
  });
});
