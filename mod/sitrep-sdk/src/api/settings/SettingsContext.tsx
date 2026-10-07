import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { getSettingDefinition } from "../../spine/settings-registry";
import type { SettingsService } from "./SettingsService";

const SettingsContext = createContext<SettingsService | null>(null);

/**
 * Makes a `SettingsService` available to `useSetting` and `useSettingsService`
 * below it.
 *
 * @category Settings
 */
export function SettingsProvider({
  service,
  children,
}: {
  service: SettingsService;
  children: ReactNode;
}) {
  return (
    <SettingsContext.Provider value={service}>
      {children}
    </SettingsContext.Provider>
  );
}

/**
 * The `SettingsService` from the nearest `SettingsProvider`. Throws outside one.
 *
 * @category Settings
 */
export function useSettingsService(): SettingsService {
  const svc = useContext(SettingsContext);
  if (!svc) {
    throw new Error(
      "useSettingsService must be used inside a <SettingsProvider>",
    );
  }
  return svc;
}

/**
 * The value of one client setting and a function that sets it, re-rendering
 * when it changes. A new value is saved and every other reader of the setting
 * sees it. This is the one to use in a component, for a setting your Uplink
 * registers with `registerSetting`: the key is that row's id. For client
 * settings only: a setting the mod publishes is read from its Topic.
 *
 * Until a value has been saved the hook returns the default of the row
 * registered under the key, so a default is stated once, on the row. The
 * second argument overrides it, and is required for a key with no registered
 * client setting. The hook throws when it has neither.
 *
 * Needs a `SettingsProvider` above it and throws without one. The dashboard
 * mounts one; a test mounts its own.
 *
 * @category Settings
 */
export function useSetting<SettingValue>(
  key: string,
  defaultValue?: SettingValue,
): [SettingValue, (v: SettingValue) => void] {
  const svc = useSettingsService();
  const [value, setValueState] = useState<SettingValue>(() =>
    svc.get(key, defaultValue ?? registeredDefault<SettingValue>(key)),
  );

  useEffect(() => svc.subscribe<SettingValue>(key, setValueState), [svc, key]);

  const setValue = useCallback(
    (next: SettingValue) => {
      svc.set(key, next);
    },
    [svc, key],
  );

  return [value, setValue];
}

function registeredDefault<SettingValue>(key: string): SettingValue {
  const def = getSettingDefinition(key);
  if (def && def.backing !== "stream-backed") {
    return def.defaultValue as SettingValue;
  }
  throw new Error(
    `useSetting("${key}") has no default: register a client setting under that key or pass one`,
  );
}
