import type { PeerMessage } from "./protocol";

/**
 * Generic per-message-type handler table. Both `PeerHostService` (with
 * `Ctx = DataConnection`) and `PeerClientService` (`Ctx = void`) build
 * one of these instead of hand-rolling a 16+ branch switch.
 *
 * Iteration is synchronous: `dispatch(msg, ctx)` looks up the handler
 * for `msg.type` and calls it inline. That preserves listener-fire
 * ordering across handler boundaries — tests that observe the order
 * messages are processed (e.g. `peer-client-service.test.ts:123`) keep
 * working without change.
 */
export type MessageHandler<T extends PeerMessage["type"], Ctx> = (
  msg: Extract<PeerMessage, { type: T }>,
  ctx: Ctx,
) => void;

export type DispatchTable<Ctx> = {
  [K in PeerMessage["type"]]?: MessageHandler<K, Ctx>;
};

export class MessageDispatcher<Ctx> {
  private readonly table: DispatchTable<Ctx>;

  constructor(table: DispatchTable<Ctx>) {
    this.table = table;
  }

  dispatch(msg: PeerMessage, ctx: Ctx): void {
    const handler = this.table[msg.type] as
      | MessageHandler<typeof msg.type, Ctx>
      | undefined;
    if (handler) handler(msg as never, ctx);
  }
}
