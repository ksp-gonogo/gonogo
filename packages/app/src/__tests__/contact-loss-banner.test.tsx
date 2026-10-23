import {
  TelemetryClient,
  TelemetryProvider,
  TimelineStore,
  ViewClock,
} from "@ksp-gonogo/sitrep-client";
import { CatalogContact } from "@ksp-gonogo/sitrep-sdk";
import {
  createFakeWallClock,
  StubTransport,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContactLossBanner } from "../components/FlightOutcomeBanner";

/* The same miniature stream as the flight outcome banner's test: a real provider over a stub transport, the view clock pinned so a manual frame advances it synchronously under fake timers. */
function setupStream(viewUt: number) {
  const wall = createFakeWallClock();
  const transport = new StubTransport();
  const client = new TelemetryClient(transport);
  const clock = new ViewClock({
    nowWall: wall.now,
    warpRate: () => 1,
    delaySeconds: () => 0,
  });
  const store = new TimelineStore(clock);
  clock.scrubTo(viewUt);

  function Provider({ children }: { children: ReactNode }) {
    return (
      <TelemetryProvider client={client} store={store}>
        {children}
      </TelemetryProvider>
    );
  }

  return {
    Provider,
    store,
    emit: (topic: string, payload: unknown) => transport.emit(topic, payload),
  };
}

describe("ContactLossBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mount(contact: Record<string, unknown>) {
    const fixture = setupStream(100);
    render(
      <fixture.Provider>
        <ContactLossBanner />
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("vessel.identity", {
        vesselId: "lander",
        name: "Mun Lander R",
        vesselType: 0,
        situation: 6,
        parentBodyIndex: 2,
        launchUt: null,
      });
      fixture.emit("trackingStation.catalog", {
        entries: [
          {
            vesselId: "lander",
            name: "Mun Lander R",
            vesselType: 0,
            situation: 6,
            ...contact,
          },
        ],
      });
      fixture.store.beginFrame();
    });
    return fixture;
  }

  it("says nothing while the craft is in contact", () => {
    mount({ contact: CatalogContact.InContact, lastContactUt: 100 });
    expect(screen.queryByText(/OVERDUE|PRESUMED LOST/)).toBeNull();
  });

  it("says nothing while a silent craft is not yet overdue", () => {
    mount({
      contact: CatalogContact.Silent,
      lastContactUt: 60,
      expectedReturnUt: 400,
      overdueAfterUt: 500,
    });
    expect(screen.queryByText(/OVERDUE|PRESUMED LOST/)).toBeNull();
  });

  it("names a craft overdue, with when it was last heard, and never destroyed", () => {
    mount({
      contact: CatalogContact.Silent,
      lastContactUt: 60,
      expectedReturnUt: 80,
      overdueAfterUt: 90,
    });
    expect(screen.getByText("OVERDUE")).toBeInTheDocument();
    expect(screen.getByText("Mun Lander R")).toBeInTheDocument();
    // The banner and the polite live region both carry it.
    expect(screen.getAllByText(/no contact since/)).toHaveLength(2);
    expect(screen.queryByText(/destroyed|crashed/i)).toBeNull();
  });

  it("names a craft presumed lost once the home centre has declared it", () => {
    mount({
      contact: CatalogContact.Lost,
      lastContactUt: 60,
      declaredLostUt: 95,
    });
    expect(screen.getByText("PRESUMED LOST")).toBeInTheDocument();
    // The banner and the polite live region both carry it.
    expect(screen.getAllByText(/no contact since/)).toHaveLength(2);
    expect(screen.queryByText(/destroyed|crashed/i)).toBeNull();
  });
});
