namespace Gonogo.KSP.CurrencyDelay
{
    /// <summary>
    /// The pure conversion from a flushed <see cref="AggregatedScienceChunk"/> to the
    /// <see cref="PendingCreditRow"/> the ledger stores - the one step both RevealApplier's
    /// aggregator drain (a vessel that stopped transmitting mid-window) and
    /// <see cref="DelayedScienceSink"/>'s per-increment flush (an external continuous science
    /// source, fed through the same aggregator) need identically. Kept separate from both so it is
    /// unit-tested unconditionally: the aggregator already resolved its own RevealUt (the
    /// light-time of the increment that closed its window), so this is a straight field carry, not
    /// a recomputation.
    /// </summary>
    public static class ScienceChunkCredit
    {
        public static PendingCreditRow ToPendingCreditRow(AggregatedScienceChunk chunk, string originDescription = "")
        {
            return new PendingCreditRow(
                DelayedCurrency.Science,
                chunk.Amount,
                chunk.RevealUt,
                chunk.VesselId,
                originDescription);
        }
    }
}
