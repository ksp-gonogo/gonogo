using System.Collections.Generic;
using System.Linq;
using Gonogo.KSP.CurrencyDelay;
using Xunit;

public class VesselScienceAggregatorTests
{
    [Fact]
    public void A_flood_of_tiny_increments_collapses_into_a_handful_of_chunks_with_no_science_lost()
    {
        // Live-confirmed shape (currency-delay-followups.md): one session
        // fired RetrieveScience 25,000 times, almost all sub-0.01 science.
        // Tiny enough per-call that the threshold never fires; only the
        // ~2.5s cadence should be closing windows, so 25,000 calls over a
        // non-round span of game-UT should collapse to roughly (span /
        // cadence) chunks, not 25,000 rows, and the summed amount must
        // exactly match what went in.
        var aggregator = new VesselScienceAggregator();
        const int callCount = 25_000;
        const double perCallIncrement = 0.0000001; // sub-0.01, matches the live spike
        const double perCallUtStep = 0.001; // 25,000 * 0.001 = 25s of game-UT

        var chunks = new List<AggregatedScienceChunk>();
        double nowUt = 0;
        for (var i = 0; i < callCount; i++)
        {
            nowUt += perCallUtStep;
            var flushed = aggregator.Accept("vessel-flood", perCallIncrement, nowUt, lightTimeSeconds: 120.0);
            if (flushed.HasValue)
            {
                chunks.Add(flushed.Value);
            }
        }

        // Drain whatever partial window is left open at the end (25s isn't
        // guaranteed to land exactly on a cadence boundary).
        chunks.AddRange(aggregator.Drain(nowUt + VesselScienceAggregator.FlushCadenceSeconds));

        Assert.InRange(chunks.Count, 1, 20); // "a handful", not 25,000
        Assert.All(chunks, c => Assert.Equal("vessel-flood", c.VesselId));

        var totalIn = callCount * perCallIncrement;
        var totalOut = chunks.Sum(c => c.Amount);
        Assert.Equal(totalIn, totalOut, 9);
    }

    [Fact]
    public void The_cadence_alone_triggers_a_flush_once_elapsed_even_below_threshold()
    {
        var aggregator = new VesselScienceAggregator();

        var beforeCadence = aggregator.Accept("vessel-a", 0.001, nowUt: 0.0, lightTimeSeconds: 10.0);
        Assert.Null(beforeCadence);

        var stillBeforeCadence = aggregator.Accept("vessel-a", 0.001, nowUt: 2.4, lightTimeSeconds: 10.0);
        Assert.Null(stillBeforeCadence);

        var atCadence = aggregator.Accept("vessel-a", 0.001, nowUt: 2.5, lightTimeSeconds: 10.0);

        Assert.NotNull(atCadence);
        Assert.Equal("vessel-a", atCadence!.Value.VesselId);
        Assert.Equal(0.003, atCadence.Value.Amount, 9);
        Assert.Equal(2.5 + 10.0, atCadence.Value.RevealUt, 9);
    }

    [Fact]
    public void The_threshold_alone_triggers_a_flush_well_before_the_cadence_elapses()
    {
        var aggregator = new VesselScienceAggregator();

        var belowThreshold = aggregator.Accept("vessel-b", 0.05, nowUt: 0.0, lightTimeSeconds: 5.0);
        Assert.Null(belowThreshold);

        var crossesThreshold = aggregator.Accept("vessel-b", 0.06, nowUt: 0.1, lightTimeSeconds: 5.0);

        Assert.NotNull(crossesThreshold);
        Assert.Equal(0.11, crossesThreshold!.Value.Amount, 9);
        Assert.Equal(0.1 + 5.0, crossesThreshold.Value.RevealUt, 9);
        Assert.True(0.1 - 0.0 < VesselScienceAggregator.FlushCadenceSeconds, "sanity: this flush happened well inside the cadence window");
    }

    [Fact]
    public void A_moving_vessel_reveals_using_the_light_time_of_the_increment_that_closed_the_window()
    {
        // The vessel travels Mun -> Kerbin during one window: light-time
        // shrinks across the increments. RevealUt should reflect the LAST
        // (closest-to-KSC) light-time captured before the flush, not the
        // first - the chunk-level version of "science smears across
        // arrival".
        var aggregator = new VesselScienceAggregator();

        Assert.Null(aggregator.Accept("vessel-moving", 0.01, nowUt: 0.0, lightTimeSeconds: 300.0)); // at the Mun
        Assert.Null(aggregator.Accept("vessel-moving", 0.01, nowUt: 1.0, lightTimeSeconds: 150.0)); // en route
        var flushed = aggregator.Accept("vessel-moving", 0.01, nowUt: 2.6, lightTimeSeconds: 2.0); // near Kerbin, cadence trips here

        Assert.NotNull(flushed);
        Assert.Equal(2.6 + 2.0, flushed!.Value.RevealUt, 9); // uses the LAST light-time (2.0), not the first (300.0)
        Assert.Equal(0.03, flushed.Value.Amount, 9);
    }

    [Fact]
    public void Two_vessels_transmitting_concurrently_keep_independent_windows_and_thresholds()
    {
        var aggregator = new VesselScienceAggregator();

        // vessel-x crosses the threshold on its second call.
        Assert.Null(aggregator.Accept("vessel-x", 0.09, nowUt: 0.0, lightTimeSeconds: 1.0));
        // vessel-y accumulates small amounts that never cross the threshold in this window.
        Assert.Null(aggregator.Accept("vessel-y", 0.001, nowUt: 0.0, lightTimeSeconds: 1.0));

        var xFlush = aggregator.Accept("vessel-x", 0.02, nowUt: 0.5, lightTimeSeconds: 1.0);
        Assert.NotNull(xFlush);
        Assert.Equal("vessel-x", xFlush!.Value.VesselId);
        Assert.Equal(0.11, xFlush.Value.Amount, 9);

        // vessel-y's window must be untouched by vessel-x's flush.
        var yFlush = aggregator.Accept("vessel-y", 0.001, nowUt: 0.6, lightTimeSeconds: 1.0);
        Assert.Null(yFlush);

        var yCadenceFlush = aggregator.Accept("vessel-y", 0.001, nowUt: 2.5, lightTimeSeconds: 1.0);
        Assert.NotNull(yCadenceFlush);
        Assert.Equal("vessel-y", yCadenceFlush!.Value.VesselId);
        Assert.Equal(0.003, yCadenceFlush.Value.Amount, 9);
    }

    [Fact]
    public void A_vessel_that_stops_transmitting_mid_window_is_still_drained_by_a_later_tick()
    {
        var aggregator = new VesselScienceAggregator();

        var duringTransmission = aggregator.Accept("vessel-stalled", 0.02, nowUt: 100.0, lightTimeSeconds: 20.0);
        Assert.Null(duringTransmission);

        // No further Accept calls for this vessel - it stopped transmitting.
        // A tick well short of the cadence must not drain it yet.
        var tooSoon = aggregator.Drain(nowUt: 101.0);
        Assert.Empty(tooSoon);

        // A tick past the cadence (relative to the window's start) drains
        // the stranded partial chunk.
        var drained = aggregator.Drain(nowUt: 100.0 + VesselScienceAggregator.FlushCadenceSeconds);

        var chunk = Assert.Single(drained);
        Assert.Equal("vessel-stalled", chunk.VesselId);
        Assert.Equal(0.02, chunk.Amount, 9);
        Assert.Equal(100.0 + 20.0, chunk.RevealUt, 9); // anchored to the LAST increment's UT (100.0), not the drain-check time

        // Draining again must not double-flush an already-flushed vessel.
        var drainedAgain = aggregator.Drain(nowUt: 1000.0);
        Assert.Empty(drainedAgain);
    }
}
