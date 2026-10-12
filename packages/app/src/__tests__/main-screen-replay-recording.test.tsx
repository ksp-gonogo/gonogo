import { clearRegistry, ErrorBoundary } from "@ksp-gonogo/core";
import {
  getAutoRecordStatus,
  getReplaySessionController,
  resetAutoRecordStatusForTests,
  resetReplaySessionControllerForTests,
} from "@ksp-gonogo/data";
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
    resetReplaySessionControllerForTests();
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

    // The stub delivers only to a subscribed Topic, so the event is offered until the recorder has subscribed and taken it.
    await waitFor(() => {
      act(() => {
        transport.emit(
          "flight.started",
          { flightId: "f1", vesselId: "v1", vesselName: "Kerbal X", ut: 10 },
          { validAt: 10, deliveredAt: 10 },
        );
      });
      expect(getAutoRecordStatus().recording).toBe(true);
    });

    act(() => {
      getReplaySessionController().start(
        {
          id: "m1",
          vesselName: "Old Flight",
          launchedAt: 0,
          firstFrameUt: 0,
          lastFrameUt: 1,
          frameCount: 0,
          starred: false,
        },
        { frames: [] },
      );
    });
    expect(getReplaySessionController().getSnapshot().active).toBe(true);
    expect(getAutoRecordStatus()).toMatchObject({
      recording: true,
      vesselName: "Kerbal X",
    });

    unmount();
    await act(async () => {});
  });
});
