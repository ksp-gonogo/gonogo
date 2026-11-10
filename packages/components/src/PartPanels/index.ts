import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import { registerPartPanelFallback } from "@ksp-gonogo/sitrep-sdk";
import { gameWindowFallback } from "./GameWindowPanel";
import { ReviewDataPanel } from "./ReviewDataPanel";

/* Asked only after every registered panel, so a console version of a window always takes the button. */
registerPartPanelFallback(gameWindowFallback);

/* Registered through the same handle method an Uplink calls, so the built-in routes have no path of their own. */
CORE_UPLINK_CLIENT.registerPartPanel({
  id: "review-data",
  title: "Review Data",
  component: ReviewDataPanel,
  replaces: [
    { module: "ModuleScienceExperiment", event: "ReviewDataEvent" },
    { module: "ModuleScienceContainer", event: "ReviewDataEvent" },
  ],
});
