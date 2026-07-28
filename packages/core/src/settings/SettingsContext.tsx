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
 * `SettingsService` and broadcast to other subscribers.
 *
 * This is the CLIENT-PREF path only, source-backed settings never route
 * through here (their value lives on a `DataSource`, not `SettingsService`);
 * `SettingsModal` renders those with a dedicated source-bound row so this hook
 * stays a simple, single-purpose localStorage reader.
 */
export function useSetting<T>(
  key: string,
  defaultValue: T,
): [T, (v: T) => void] {
  const svc = useSettingsService();
  const [value, setValueState] = useState<T>(() => svc.get(key, defaultValue));

  useEffect(() => svc.subscribe<T>(key, setValueState), [svc, key]);

  const setValue = useCallback(
    (next: T) => {
      svc.set(key, next);
    },
    [svc, key],
  );

  return [value, setValue];
}
