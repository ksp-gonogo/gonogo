import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePeerClient } from "../peer/PeerClientContext";

export interface PushIntent {
  widgetInstanceId: string;
  componentId: string;
  config: Record<string, unknown>;
  width: number;
  height: number;
}

interface PushClientValue {
  /** Whether the local station has marked this widget instance as pushed. */
  isPushed: (widgetInstanceId: string) => boolean;
  /** Send a widget-push message and mark local state. */
  push: (intent: PushIntent) => void;
  /** Send a widget-recall message and clear local state. */
  recall: (widgetInstanceId: string) => void;
}

const PushClientContext = createContext<PushClientValue | null>(null);

export function PushClientProvider({ children }: { children: ReactNode }) {
  const client = usePeerClient();
  const [pushed, setPushed] = useState<ReadonlyMap<string, PushIntent>>(
    () => new Map(),
  );
  const pushedRef = useRef(pushed);
  pushedRef.current = pushed;

  /* The main screen forgets a station's pushed widgets when the link drops,
     and a restarted main screen never had them. Every hello is therefore
     answered with the widgets this station still means to have pushed, which
     also covers a push made while the link was down. */
  useEffect(() => {
    if (!client) return;
    return client.onHostHello(() => {
      for (const intent of pushedRef.current.values()) {
        client.sendWidgetPush(intent);
      }
    });
  }, [client]);

  const push = useCallback(
    (intent: PushIntent) => {
      if (!client) return;
      client.sendWidgetPush(intent);
      setPushed((prev) => new Map(prev).set(intent.widgetInstanceId, intent));
    },
    [client],
  );

  const recall = useCallback(
    (widgetInstanceId: string) => {
      if (!client) return;
      client.sendWidgetRecall(widgetInstanceId);
      setPushed((prev) => {
        if (!prev.has(widgetInstanceId)) return prev;
        const next = new Map(prev);
        next.delete(widgetInstanceId);
        return next;
      });
    },
    [client],
  );

  const value = useMemo<PushClientValue>(
    () => ({
      isPushed: (id) => pushed.has(id),
      push,
      recall,
    }),
    [pushed, push, recall],
  );

  return (
    <PushClientContext.Provider value={value}>
      {children}
    </PushClientContext.Provider>
  );
}

/**
 * Returns the push-client API, or null when rendered outside a
 * PushClientProvider (i.e. on the main screen). The Dashboard uses this
 * return value to decide whether to render the "Push to main" button.
 */
export function usePushClient(): PushClientValue | null {
  return useContext(PushClientContext);
}
