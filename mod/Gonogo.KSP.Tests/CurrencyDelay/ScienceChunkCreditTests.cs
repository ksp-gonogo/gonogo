using Gonogo.KSP.CurrencyDelay;
using Xunit;

public class ScienceChunkCreditTests
{
    [Fact]
    public void ToPendingCreditRow_carries_every_chunk_field_through_unchanged()
    {
        var chunk = new AggregatedScienceChunk("vessel-x", amount: 12.5, revealUt: 4200.0);

        var row = ScienceChunkCredit.ToPendingCreditRow(chunk, "buffered-science");

        Assert.Equal(DelayedCurrency.Science, row.Currency);
        Assert.Equal(12.5, row.BaseAmount);
        Assert.Equal(4200.0, row.RevealUt);
        Assert.Equal("vessel-x", row.OriginVesselId);
        Assert.Equal("buffered-science", row.OriginDescription);
    }

    [Fact]
    public void ToPendingCreditRow_defaults_the_origin_description_to_empty()
    {
        var chunk = new AggregatedScienceChunk("vessel-y", amount: 1.0, revealUt: 10.0);

        var row = ScienceChunkCredit.ToPendingCreditRow(chunk);

        Assert.Equal("", row.OriginDescription);
    }

    [Fact]
    public void The_aggregator_flush_to_ledger_enqueue_path_preserves_the_summed_amount()
    {
        // Simulates DelayedScienceSink's per-increment flow: many small increments for one vessel,
        // fed through the aggregator, converted to a ledger row the moment a chunk flushes. The
        // row's BaseAmount must exactly equal the sum of every increment that went into it - the
        // whole point of aggregating instead of dropping science between calls.
        var aggregator = new VesselScienceAggregator();
        double total = 0.0;

        AggregatedScienceChunk? flushed = null;
        for (var i = 0; i < 50 && flushed == null; i++)
        {
            const double increment = 0.003;
            total += increment;
            flushed = aggregator.Accept("vessel-a", increment, nowUt: i * 0.05, lightTimeSeconds: 42.0);
        }

        Assert.NotNull(flushed);
        var row = ScienceChunkCredit.ToPendingCreditRow(flushed!.Value, "buffered-science");

        Assert.Equal(total, row.BaseAmount, 9);
        Assert.Equal("vessel-a", row.OriginVesselId);
    }

    [Fact]
    public void A_buffered_science_increment_with_a_light_time_produces_a_credit_with_the_right_reveal_ut()
    {
        // Mirrors DelayedScienceSink.RecordDelayedScienceIncrement: one increment, tagged with the
        // light-time KscLightTime.ForProtoVessel would have returned for the transmitting vessel,
        // closes the window on threshold (a single increment above FlushThresholdScience). RevealUt
        // must be exactly nowUt + lightTimeSeconds, the same rule the stock path relies on.
        var aggregator = new VesselScienceAggregator();
        const double nowUt = 12345.0;
        const double lightTimeSeconds = 87.5;

        var flushed = aggregator.Accept("vessel-mun", increment: 0.5, nowUt, lightTimeSeconds);
        Assert.NotNull(flushed);

        var row = ScienceChunkCredit.ToPendingCreditRow(flushed!.Value, "buffered-science");

        Assert.Equal(nowUt + lightTimeSeconds, row.RevealUt, 9);
        Assert.Equal(0.5, row.BaseAmount, 9);
        Assert.Equal("vessel-mun", row.OriginVesselId);
    }
}
