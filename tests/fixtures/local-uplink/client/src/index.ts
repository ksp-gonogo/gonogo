import { registerComponent } from "@ksp-gonogo/sitrep-sdk";
import { createElement } from "react";

registerComponent({
  id: "local-fixture-widget",
  name: "Local Fixture",
  description:
    "Renders one sentence, to prove a local build linked to the app.",
  tags: ["fixture"],
  component: () =>
    createElement("p", null, "The local fixture widget rendered from a bundle"),
  defaultSize: { w: 4, h: 3 },
});
