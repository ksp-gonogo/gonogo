// Render-time setup for this Uplink's own scenes.
//
// The plan composer's drafts live in a module-scoped store, not in React state,
// which is what lets a half-composed plan survive the widget being scrolled out
// of the dashboard. One page renders every scene in turn, so without this the
// drafts one scene presses into existence are still there for the next one: the
// upload-armed scene came out showing three saved plans, two of them left behind
// by the scenes before it, and every one of those pictures is of a composer
// nobody composed.

import { clearPlanDrafts } from "@ksp-gonogo/sitrep-sdk/testing";
import { defineRenderSetup } from "@ksp-gonogo/ui-kit/render-probe";

export default defineRenderSetup({
  beforeScene() {
    clearPlanDrafts();
  },
});
