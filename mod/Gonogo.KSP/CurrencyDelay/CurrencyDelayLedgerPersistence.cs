namespace Gonogo.KSP.CurrencyDelay
{
    /// <summary>
    /// Nests a <see cref="PendingCreditLedger"/>'s <c>ToConfigNode</c>/<c>FromConfigNode</c>
    /// round-trip inside a scenario module's own persisted <c>ConfigNode</c>, and loads it back
    /// into an EXISTING ledger instance rather than replacing it.
    ///
    /// That distinction matters because <c>CurrencyDelayScenario</c> constructs one shared
    /// <see cref="PendingCreditLedger"/> in <c>OnAwake</c> and hands the SAME instance to the
    /// stock interceptor and the reveal applier (and binds it onto DelayedScienceSink); if
    /// <c>OnLoad</c> swapped in
    /// a brand-new ledger returned by <c>PendingCreditLedger.FromConfigNode</c>, those three would
    /// keep holding the stale, empty one. <see cref="Load"/> instead merges the loaded rows into
    /// the caller's own ledger via <c>Enqueue</c>, so every consumer sees the restored state
    /// without needing to be told about a reference swap.
    ///
    /// Only touches <see cref="PendingCreditLedger"/>/<see cref="PendingCreditRow"/> and
    /// <c>ConfigNode</c> - same dependency footprint as <c>PendingCreditLedger.cs</c> itself
    /// (a plain KSP data type, no scene/runtime dependency), so it needs the same KspManaged
    /// gating as that class and no more.
    /// </summary>
    public static class CurrencyDelayLedgerPersistence
    {
        // Matches the name PendingCreditLedger.ToConfigNode() already gives its own root node,
        // so Save/Load below just add/read that node by its own name rather than re-wrapping it
        // under a second, different name.
        private const string LedgerNodeName = "PENDING_CREDIT_LEDGER";

        /// <summary>Nests the ledger's own ConfigNode as a single child of <paramref name="node"/>.</summary>
        public static void Save(PendingCreditLedger ledger, ConfigNode node)
        {
            node.AddNode(ledger.ToConfigNode());
        }

        /// <summary>
        /// Reads the nested ledger node back, if present, and enqueues its rows onto
        /// <paramref name="target"/>. A save from before this subsystem existed (or a brand-new
        /// game with nothing persisted yet) has no such node - target is left exactly as it was
        /// constructed (empty).
        /// </summary>
        public static void Load(PendingCreditLedger target, ConfigNode node)
        {
            var ledgerNode = node?.GetNode(LedgerNodeName);
            if (ledgerNode == null)
            {
                return;
            }

            var loaded = PendingCreditLedger.FromConfigNode(ledgerNode);
            foreach (var row in loaded.Pending)
            {
                target.Enqueue(row);
            }
        }
    }
}
