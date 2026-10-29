import { registerAugment, registerUplinkTopic } from "@ksp-gonogo/sitrep-sdk";
import { PLANTED_UPLINK } from "./plantedUplink";

/**
 * A stand-in for a map source with no data yet: a Ground Track base layer that
 * hides the stock terrain and paints nothing. Requires its own Domain, so only
 * a fixture emitting {@link PLANTED_EMPTY_MAP_AVAILABLE_TOPIC} gets it.
 */
const PLANTED_EMPTY_MAP_DOMAIN = "planted-empty-map";

export const PLANTED_EMPTY_MAP_AVAILABLE_TOPIC = `${PLANTED_EMPTY_MAP_DOMAIN}.available`;

registerUplinkTopic(PLANTED_EMPTY_MAP_AVAILABLE_TOPIC);

registerAugment({
  id: "planted-empty-map:base",
  augments: "ground-track.base",
  requires: PLANTED_EMPTY_MAP_DOMAIN,
  owner: PLANTED_UPLINK,
  label: "Empty map source",
  suppressesVanillaBase: true,
  component: () => null,
});
