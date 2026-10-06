import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
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
 * sees it. For client settings only: a setting the mod publishes is read from
 * its Topic.
 *
 * @category Settings
 */
export function useSetting<SettingValue>(
  key: string,
  defaultValue: SettingValue,
): [SettingValue, (v: SettingValue) => void] {
  const svc = useSettingsService();
  const [value, setValueState] = useState<SettingValue>(() =>
    svc.get(key, defaultValue),
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
