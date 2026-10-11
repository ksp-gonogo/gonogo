import { useCallback, useRef } from "react";
import type { ProbeMount } from "../../components/scripts/probe/probe-entry";
import { WidgetScene, type WidgetSceneProps } from "./WidgetScene";

/** One press on a control the operator would reach for, found by its words. */
export interface ScenePress {
  /** Text the control's label carries. */
  text: string;
  /** Narrows it to a kind of control, when the same words appear on another. */
  selector?: string;
}

export interface AppWidgetSceneProps
  extends Omit<WidgetSceneProps, "onMounted"> {
  /**
   * Presses made in order once the scene has mounted, each waited for until
   * its control exists and is enabled, so a view several clicks in is reached
   * the way an operator reaches it.
   */
  presses?: readonly ScenePress[];
  /** Handed the scene's mount and its own subtree once every press has been made. */
  onDriven?: (mount: ProbeMount, root: HTMLElement) => void;
}

/** How long one press waits for its control before the scene gives up on it. */
const PRESS_DEADLINE_MS = 3_000;

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function enabledControl(root: Element, press: ScenePress): HTMLElement | null {
  const found = [
    ...root.querySelectorAll<HTMLElement>(press.selector ?? "button"),
  ].find(
    (el) =>
      !(el as HTMLButtonElement).disabled &&
      (el.textContent ?? "").includes(press.text),
  );
  return found ?? null;
}

async function pressWhenReady(root: Element, press: ScenePress): Promise<void> {
  const deadline = Date.now() + PRESS_DEADLINE_MS;
  while (Date.now() < deadline) {
    const control = enabledControl(root, press);
    if (control) {
      control.click();
      await frame();
      await frame();
      return;
    }
    await frame();
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  throw new Error(`Scene: no enabled control reading "${press.text}"`);
}

/**
 * A {@link WidgetScene} that is then driven through its own controls. The
 * presses run against this scene's subtree alone, so two scenes on one page
 * never press each other's buttons.
 */
export function AppWidgetScene({
  presses,
  onDriven,
  ...scene
}: AppWidgetSceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const steps = useRef(presses);
  steps.current = presses;
  const after = useRef(onDriven);
  after.current = onDriven;

  const mounted = useCallback(async (mount: ProbeMount) => {
    const root = host.current;
    if (!root) return;
    for (const press of steps.current ?? []) {
      await pressWhenReady(root, press);
    }
    after.current?.(mount, root);
  }, []);

  return (
    <div ref={host}>
      <WidgetScene {...scene} onMounted={mounted} />
    </div>
  );
}
