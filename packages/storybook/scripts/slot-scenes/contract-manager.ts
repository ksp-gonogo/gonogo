import type { ExtensionScene } from "../coverage";

export const SCENES: readonly ExtensionScene[] = [
  {
    // The stub follows the contract list, which fills the tile before it.
    id: "planted-slot:contract-manager.sections",
    widgetId: "contract-manager",
    fixture:
      "packages/components/src/ContractManager/__fixtures__/multiple-active-contracts.json",
    w: 12,
    h: 20,
  },
];
