import { isTextEntry } from "@ksp-gonogo/serial";
import { useEffect } from "react";
import type { ProfileDashboard } from "../missionProfiles";
import { useOpenComponentPicker } from "./ComponentOverlay";

/** An open dialog or the Add widget picker owns the keyboard until it closes. */
function dialogIsOpen(): boolean {
  return (
    document.querySelector('[role="dialog"], [aria-modal="true"]') !== null
  );
}

/**
 * Screen-wide keyboard shortcuts for editing the dashboard: Ctrl or Cmd with Z
 * undoes a layout change, with Shift and Z (or Ctrl and Y) redoes it, and Ctrl
 * or Cmd with K opens Add widget. Useful for editing a layout without leaving
 * the keyboard. Every one is a chord with Ctrl or Cmd, which the keyboard
 * input device never reads, so no bound key can collide with them. A key
 * pressed in a text field or while a dialog is open is left alone, so a field
 * keeps its own undo. Renders nothing; mount it once per screen inside the
 * Add widget picker's provider.
 */
export function DashboardShortcuts({
  history,
}: Readonly<{ history: Pick<ProfileDashboard, "undo" | "redo"> }>) {
  const openPicker = useOpenComponentPicker();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing || e.repeat) return;
      if (e.altKey || !(e.ctrlKey || e.metaKey)) return;
      if (isTextEntry(e.target instanceof Element ? e.target : null)) return;
      if (dialogIsOpen()) return;

      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
        return;
      }
      if (key === "y" && e.ctrlKey && !e.shiftKey && !e.metaKey) {
        e.preventDefault();
        history.redo();
        return;
      }
      if (key === "k" && !e.shiftKey && openPicker) {
        e.preventDefault();
        openPicker();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [history, openPicker]);

  return null;
}
