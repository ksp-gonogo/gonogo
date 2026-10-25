import { SettingKind } from "@ksp-gonogo/sitrep-sdk";
import { relayBaseUrl } from "../peer/relayAddress";
import { registerSetting } from "../settings/registry";

/** The setting's id; the container's `GONOGO_AUTO_PORT_FORWARD` is its starting value. */
export const AUTO_PORT_FORWARD_SETTING = "relay.autoPortForward";

/** The router address setting; the container's `ROUTER_IP` is its starting value. */
export const ROUTER_ADDRESS_SETTING = "relay.routerIp";

registerSetting({
  id: AUTO_PORT_FORWARD_SETTING,
  type: SettingKind.Bool,
  label: "Automatic port forwarding",
  description:
    "Asks your router, at the address below, to open the relay's port, so friends on other networks can join, and closes it again when the relay stops. Off: forward port 47100 (UDP and TCP) to this computer yourself, or play on this network only.",
  category: "Relay",
  defaultValue: false,
  screens: ["main"],
});

registerSetting({
  id: ROUTER_ADDRESS_SETTING,
  type: SettingKind.Text,
  label: "Router address",
  description:
    "Your router's address, four numbers separated by dots. It is usually printed on the router's label, and this computer's network settings show it as Router or Default Gateway.",
  category: "Relay",
  defaultValue: "",
  screens: ["main"],
});

const IPV4 =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** Whether `text` is a router address the relay takes: four numbers from 0 to 255, separated by dots. */
export function isRouterAddress(text: string): boolean {
  return IPV4.test(text.trim());
}

/** How often a chosen value is sent again, so a relay that restarted picks it up. */
const RESEND_MS = 30_000;

/** What the main screen sends the relay: the switch, and the router address when the player gave a valid one. */
export interface PortForwardChoice {
  enabled: boolean;
  routerIp?: string;
}

/** Tell the relay to switch automatic port forwarding on or off. Best-effort: a relay that is not running answers nothing. */
export async function postAutoPortForward(
  choice: PortForwardChoice,
): Promise<void> {
  try {
    await fetch(`${relayBaseUrl()}/port-forward`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(choice),
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
 * settings. Until the player has chosen, the relay keeps the values it started
 * with (`GONOGO_AUTO_PORT_FORWARD` and `ROUTER_IP`); once they have, their
 * choice is sent at start, on every change of either setting, and again every
 * half minute. A router address is sent only once it is a valid one.
 */
export function syncAutoPortForward(
  settings: SettingsStore,
  post: (choice: PortForwardChoice) => Promise<void> = postAutoPortForward,
): () => void {
  const current = (): PortForwardChoice | null => {
    const enabled = settings.get<boolean | null>(
      AUTO_PORT_FORWARD_SETTING,
      null,
    );
    if (enabled === null) return null;
    const router = settings.get<string>(ROUTER_ADDRESS_SETTING, "").trim();
    return isRouterAddress(router)
      ? { enabled, routerIp: router }
      : { enabled };
  };
  const send = () => {
    const choice = current();
    if (choice) void post(choice);
  };
  send();
  const stops = [
    settings.subscribe(AUTO_PORT_FORWARD_SETTING, send),
    settings.subscribe(ROUTER_ADDRESS_SETTING, send),
  ];
  const timer = setInterval(send, RESEND_MS);
  return () => {
    for (const stop of stops) stop();
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
