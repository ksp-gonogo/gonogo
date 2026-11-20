import { clearRegistry, ErrorBoundary } from "@ksp-gonogo/core";
import {
  getAutoRecordStatus,
  resetAutoRecordStatusForTests,
} from "@ksp-gonogo/data";
import { setModeLayer } from "@ksp-gonogo/sitrep-client";
import {
  act,
  render,
  StubTransport,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { ModalProvider } from "@ksp-gonogo/ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_CONSENT_KEY } from "../analytics/AnalyticsConsentService";
import "../dataSources/missionHistory";
import { MainScreen } from "../screens/MainScreen";

describe("MainScreen: a replay and the live recording", () => {
  beforeEach(() => {
    clearRegistry();
    localStorage.clear();
    localStorage.setItem(ANALYTICS_CONSENT_KEY, "disabled");
    resetAutoRecordStatusForTests();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    setModeLayer(undefined);
    vi.unstubAllGlobals();
  });

  it("keeps recording the live flight when a replay starts", async () => {
    const transport = new StubTransport();
    const { unmount } = render(
      <ErrorBoundary>
        <ModalProvider>
          <MainScreen transport={transport} />
        </ModalProvider>
      </ErrorBoundary>,
    );

    // The stub delivers only to a subscribed Topic, so the events are offered until the recorder has subscribed and taken them. The scene and a tick in it come with the flight, as they do on a real load.
    await waitFor(() => {
      act(() => {
        transport.emit(
          "spaceCenter.scene",
          { scene: "Flight" },
          { validAt: 10, deliveredAt: 10 },
        );
        transport.emit(
          "flight.started",
          { flightId: "f1", vesselId: "v1", vesselName: "Kerbal X", ut: 10 },
          { validAt: 10, deliveredAt: 10 },
        );
        transport.emit(
          "flight.current",
          { flightId: "f1", vesselName: "Kerbal X", ut: 10 },
          { validAt: 10, deliveredAt: 10 },
        );
      });
      expect(getAutoRecordStatus().recording).toBe(true);
    });

    // A replay comes on: the mod says so, and this screen is given a recording's frames to show.
    act(() => {
      transport.emit(
        "mode.state",
        {
          mode: "replay",
          name: "Replay",
          answers: "craft",
          modelled: false,
          inputs: [],
          timeline: null,
          noTimeline: "",
          entry: 1,
        },
        { validAt: 11, deliveredAt: 11 },
      );
      setModeLayer({
        mode: "replay",
        entry: 1,
        modelled: false,
        frames: [
          JSON.stringify({
            type: "stream-data",
            topic: "flight.current",
            payload: { flightId: "old", vesselName: "Old Flight", ut: 1 },
            meta: {
              source: "mode",
              validAt: 1,
              seq: 1,
              deliveredAt: 1,
              vantage: "meta",
              active: true,
              staleness: 0,
              timelineEpoch: 0,
              mode: "replay",
            },
          }),
        ],
      });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    // The recorder reads the live stream, never the replay laid over the tiles.
    expect(getAutoRecordStatus()).toMatchObject({
      recording: true,
      vesselName: "Kerbal X",
    });

    unmount();
    await act(async () => {});
  });
});
