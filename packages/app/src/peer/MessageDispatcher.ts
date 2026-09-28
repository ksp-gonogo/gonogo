import type { PeerMessage } from "./protocol";

/**
 * Generic per-message-type handler table. Both `PeerHostService` (with
 * `Context = DataConnection`) and `PeerClientService` (`Context = void`) build
 * one of these instead of hand-rolling a 16+ branch switch.
 *
 * Iteration is synchronous: `dispatch(msg, ctx)` looks up the handler
 * for `msg.type` and calls it inline. That preserves listener-fire
 * ordering across handler boundaries: tests that observe the order
 * messages are processed (e.g. `peer-client-service.test.ts:123`) keep
 * working without change.
 */
export type MessageHandler<MessageType extends PeerMessage["type"], Context> = (
  msg: Extract<PeerMessage, { type: MessageType }>,
  ctx: Context,
) => void;

export type DispatchTable<Context> = {
  [Key in PeerMessage["type"]]?: MessageHandler<Key, Context>;
};

export class MessageDispatcher<Context> {
  private readonly table: DispatchTable<Context>;

  constructor(table: DispatchTable<Context>) {
    this.table = table;
  }

  dispatch(msg: PeerMessage, ctx: Context): void {
    const handler = this.table[msg.type] as
      | MessageHandler<typeof msg.type, Context>
      | undefined;
    if (handler) handler(msg as never, ctx);
  }
}
