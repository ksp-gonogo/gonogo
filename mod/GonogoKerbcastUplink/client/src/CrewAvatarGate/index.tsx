import { useSetting } from "@ksp-gonogo/sitrep-sdk";

/**
 * Props the `crew-manifest.avatar` slot will pass. Shape is provisional — the
 * slot itself isn't landed yet (see the STUB note below), so this is the
 * minimal surface the gate needs today.
 */
export interface KerbcastAvatarProps {
  kerbalName?: string;
}

/**
 * STUB (read-path only). The kill-switch gate for embedded crew facecams.
 *
 * The full WIRING — registering this into the `crew-manifest.avatar` augment
 * slot and rendering the subscribing `FacecamAvatar` as the child — lands once
 * that slot + the SDK facecam `kind` exist (neither is on this branch). Until
 * then this is deliberately NOT registered into any slot; it exists to lock in
 * the gate SHAPE so wiring it up later is a drop-in.
 *
 * The gate is a COMPONENT-BOUNDARY split, not a conditional hook: when the
 * kill-switch reads OFF it returns before rendering the child, so the
 * subscribing component (where `useKerbcastStream`/`useKerbcastCamera` will
 * live) never mounts and no facecam stream is ever requested — the zero-cost
 * guarantee. When ON it renders the child. Default ON (always-live UX).
 */
export function KerbcastAvatarAugment(props: KerbcastAvatarProps) {
  const [embedded] = useSetting<boolean>("kerbcast.embeddedFacecams", true);
  if (!embedded) return null;
  return <FacecamAvatarPlaceholder {...props} />;
}

/**
 * Placeholder for the future subscribing `FacecamAvatar`. The subscription
 * hooks will live HERE, so they only run when the switch is ON and the augment
 * is wired into its slot. Renders a marker element (no facecam stream yet) so
 * the gate's on/off split is observable in tests.
 */
function FacecamAvatarPlaceholder(_props: KerbcastAvatarProps) {
  return <span aria-hidden="true" />;
}
