/** Whether `value` is the state a toggle sent with `args` set; a toggle that sets no state has nothing to wait for. */
export function showsToggle(args: unknown, value: unknown): boolean {
  if (args === null || typeof args !== "object") return true;
  if ("state" in args) return value === args.state;
  if ("enabled" in args) return value === args.enabled;
  return true;
}
