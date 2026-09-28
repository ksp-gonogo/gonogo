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
 * Reactive accessor for a single client-pref setting. Returns a
 * `[value, setValue]` tuple; mutations persist through the underlying
 * `SettingsService` and broadcast to other subscribers. Client-pref rows
 * only: a stream-backed row's value is on a Topic, not in `SettingsService`.
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
