import { SettingKind } from "@ksp-gonogo/sitrep-sdk";
import { relayBaseUrl } from "../peer/relayAddress";
import { registerSetting } from "../settings/registry";

/** The setting's id; the container's `GONOGO_AUTO_PORT_FORWARD` is its starting value. */
export const AUTO_PORT_FORWARD_SETTING = "relay.autoPortForward";

registerSetting({
  id: AUTO_PORT_FORWARD_SETTING,
  type: SettingKind.Bool,
  label: "Automatic port forwarding",
  description:
    "Asks your router to open the relay's port, so friends on other networks can join, and closes it again when the relay stops. Off: forward port 47100 (UDP and TCP) to this computer yourself, or play on this network only.",
  category: "Relay",
  defaultValue: false,
  screens: ["main"],
});

/** How often a chosen value is sent again, so a relay that restarted picks it up. */
const RESEND_MS = 30_000;

/** Tell the relay to switch automatic port forwarding on or off. Best-effort: a relay that is not running answers nothing. */
export async function postAutoPortForward(enabled: boolean): Promise<void> {
  try {
    await fetch(`${relayBaseUrl()}/port-forward`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
  } catch {
    /* no relay running */
  }
}

interface SettingsStore {
  get<SettingValue>(key: string, fallback: SettingValue): SettingValue;
  subscribe<SettingValue>(
    key: string,
    cb: (value: SettingValue) => void,
  ): () => void;
}

/**
 * Keeps the relay's automatic port forwarding in step with the main screen's
 * setting. Until the player has chosen, the relay keeps the value it started
 * with (`GONOGO_AUTO_PORT_FORWARD`); once they have, their choice is sent at
 * start, on every change, and again every half minute.
 */
export function syncAutoPortForward(
  settings: SettingsStore,
  post: (enabled: boolean) => Promise<void> = postAutoPortForward,
): () => void {
  let chosen = settings.get<boolean | null>(AUTO_PORT_FORWARD_SETTING, null);
  if (chosen !== null) void post(chosen);
  const unsubscribe = settings.subscribe<boolean>(
    AUTO_PORT_FORWARD_SETTING,
    (value) => {
      chosen = value;
      void post(value);
    },
  );
  const timer = setInterval(() => {
    if (chosen !== null) void post(chosen);
  }, RESEND_MS);
  return () => {
    unsubscribe();
    clearInterval(timer);
  };
}

/** What the relay reports about automatic port forwarding: whether it is on, and where the router forward stands. */
export interface PortForwardState {
  enabled: boolean;
  /** The router's answer in words, or null while forwarding is off. */
  mapping: { state: string; message: string } | null;
}

/** Read the relay's port forwarding state; null when the relay does not answer. */
export async function readPortForward(): Promise<PortForwardState | null> {
  try {
    const res = await fetch(`${relayBaseUrl()}/port-forward`);
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const enabled = Reflect.get(Object(body), "enabled");
    const mapping: unknown = Reflect.get(Object(body), "portMapping");
    const state = Reflect.get(Object(mapping), "state");
    const message = Reflect.get(Object(mapping), "message");
    return {
      enabled: enabled === true,
      mapping:
        typeof state === "string" && typeof message === "string"
          ? { state, message }
          : null,
    };
  } catch {
    return null;
  }
}
