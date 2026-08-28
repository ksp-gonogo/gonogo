/**
 * The slot Vehicle Assembly's body is built out of.
 *
 * <para>`sections` is a framework-universal segment, so `${widgetId}.sections`
 * exists for every widget without one being declared. What is declared here is
 * its PROPS type: a plain marker carrying none, so a section decides for itself
 * what to read off the wire rather than being handed a projection of the
 * host's.</para>
 *
 * <para>In its own module rather than beside the widget, because the widget
 * side-effect-imports its own two sections and each of those names the slot it
 * binds to. Co-located with the widget the slot belongs to either way, so
 * parallel slot work never collides on one shared registry file.</para>
 */
export const VEHICLE_ASSEMBLY_SECTIONS = "rp1-vehicle-assembly.sections";

declare module "@ksp-gonogo/sitrep-sdk" {
  interface SlotRegistry {
    "rp1-vehicle-assembly.sections": Record<string, never>;
  }
}
