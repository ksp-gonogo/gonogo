import { useEffect, useRef } from "react";
import { CommandDelay } from "./CommandDelay";
import { type CommandHandle, useActiveHandles } from "./DelayRailContext";
import { usePanelRailTarget } from "./PanelRailTarget";

/**
 * Whether a handle's `CommandDelay` would draw anything: a stream with real
 * delay, or a discrete handle with in-flight rows. Mirrors `CommandDelay`'s own
 * null-decision so the rail shows a handle iff its `CommandDelay` renders. An
 * instant / idle command (a meta-vantage or not-yet-dispatched handle) is still
 * registered, so its must-consume token is marked and it appears the instant it
 * goes in flight, but it contributes no rail chrome meanwhile.
 */
function handleHasContent(handle: CommandHandle): boolean {
  if (handle.shape === "stream") return handle.effectiveDelaySeconds > 0;
  return handle.inFlight.length > 0;
}

/**
 * The Panel-owned signal-delay rail. Reads the active command handles from the
 * nearest `DelayRailContext` (populated by `usePanelDelay` in the widget) and
 * renders each handle's delay UI through the existing `CommandDelay`
 * (`InFlightList` / `ControlDelayStream`, chosen per `handle.shape`). Takes no
 * prop: it is context-collecting, so a command widget passes nothing.
 *
 * It sits in normal flow at the true top of the scroller, above the header, and
 * publishes its own measured height into `--panel-rail-height` on the panel's
 * container (the target from `PanelRailTargetContext`, an ancestor of both the
 * rail and the ghost), the var the sticky header / ghost rests below. The
 * single ResizeObserver watches ONLY the rail element (never its content), so
 * there is no measure-render-measure feedback loop.
 *
 * Renders `null` when no active handle has anything to draw, so a widget whose
 * commands are all instant or idle gets no rail element at all (its Panel DOM is
 * unchanged, exactly as the inline `CommandDelay` drew nothing before) and the
 * panel reads the `var(--panel-rail-height, 0px)` fallback. Height "0" is that
 * fallback, not a published value: publishing 0 would require an always-mounted
 * element and would perturb every no-command widget's snapshot.
 */
export function PanelDelayRail() {
  const handles = useActiveHandles();
  const visible = handles.filter(handleHasContent);
  const hasContent = visible.length > 0;
  const railRef = useRef<HTMLDivElement>(null);
  const targetRef = usePanelRailTarget();

  // Re-run when the rail mounts / unmounts (hasContent flip). On mount it
  // observes the rail and publishes its height onto the target element (read off
  // the target ref, populated by commit time); on unmount it removes the var so
  // the panel falls back to 0px. hasContent is the mount/unmount TRIGGER (the
  // rail element appears / disappears with it), not a value read in the body,
  // which is exactly what the exhaustive-deps rule cannot see here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: hasContent is the rail-mount/unmount trigger, not a body input
  useEffect(() => {
    const rail = railRef.current;
    const target = targetRef?.current;
    if (!rail || !target || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      // Read the rail's own measured height off the observer entry (never a
      // layout read of content), the one measurement this rail makes.
      const height = entries[entries.length - 1]?.contentRect.height ?? 0;
      target.style.setProperty("--panel-rail-height", `${height}px`);
    });
    ro.observe(rail);
    return () => {
      ro.disconnect();
      target.style.removeProperty("--panel-rail-height");
    };
  }, [hasContent, targetRef]);

  if (!hasContent) return null;

  return (
    <div data-panel-rail="" ref={railRef}>
      {visible.map((h) => (
        <CommandDelay key={h.id} handle={h} />
      ))}
    </div>
  );
}
