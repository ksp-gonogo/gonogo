import { clearContributions, registerContribution } from "@ksp-gonogo/core";
import { TelemetryClient, TelemetryProvider } from "@ksp-gonogo/sitrep-client";
import type { BadgeEntry } from "@ksp-gonogo/sitrep-sdk";
import { harnessTheme, StubTransport } from "@ksp-gonogo/sitrep-sdk/testing";
import { BannerStack } from "@ksp-gonogo/ui";
import {
  createDomainAvailabilityStore,
  DomainAvailabilityContext,
} from "@ksp-gonogo/ui-kit";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "styled-components";
import { HeaderBadges } from "../../src/components/HeaderBadges";

/**
 * Browser entry for the header badge render harness. esbuild bundles it into
 * `header-badges-probe.html`, and `scripts/render-header-badges.ts` drives it
 * through `window.__renderHeaderBadges`.
 *
 * Each scene hands `app.header-badges` a stand-in contributor's entries, gated
 * on a Domain the scene either announces or does not, which is the whole path
 * any contributor takes.
 */

interface Scene {
  /** The entries the stand-in contributor returns; nothing registers when absent. */
  entries?: BadgeEntry[];
  /** Whether the contributor's Domain is announced. */
  domainPresent: boolean;
}

const STUB_DOMAIN = "stub-domain";

let root: Root | undefined;
let client: TelemetryClient | undefined;

const twoFrames = (): Promise<unknown> =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

async function renderScene(scene: Scene): Promise<void> {
  const host = document.getElementById("root");
  if (!host) throw new Error("#root missing");

  root?.unmount();
  client?.dispose();
  clearContributions();

  const entries = scene.entries;
  if (entries) {
    registerContribution({
      id: "stub.header",
      contributes: "app.header-badges",
      requires: STUB_DOMAIN,
      compute: () => entries,
    });
  }

  const availability = createDomainAvailabilityStore();
  availability.setAvailable(STUB_DOMAIN, scene.domainPresent);
  client = new TelemetryClient(new StubTransport());
  root = createRoot(host);
  root.render(
    <ThemeProvider theme={harnessTheme}>
      <DomainAvailabilityContext.Provider value={availability}>
        <TelemetryProvider client={client}>
          <BannerStack>
            <HeaderBadges />
          </BannerStack>
        </TelemetryProvider>
      </DomainAvailabilityContext.Provider>
    </ThemeProvider>,
  );
  await twoFrames();
}

(
  window as unknown as { __renderHeaderBadges: (s: Scene) => Promise<void> }
).__renderHeaderBadges = renderScene;
