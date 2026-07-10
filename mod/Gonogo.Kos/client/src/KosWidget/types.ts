import type { KosWidgetArg } from "@gonogo/data";

export type { KosWidgetArg };

export interface KosWidgetConfig {
  /** Tagname of the kOS CPU to target. */
  cpu?: string;
  /** Script name (without args). Example: "deltav.ks" or just "deltav". */
  script?: string;
  /** Widget-level args — number/string/boolean literals, or telemetry bindings. */
  args?: KosWidgetArg[];
  /** "command" runs on button click; "interval" auto-polls. */
  mode?: "command" | "interval";
  /** When mode === "interval", delay between dispatches. Default 1000ms. */
  intervalMs?: number;
  /** Optional human-readable title for the widget header. */
  title?: string;
}
