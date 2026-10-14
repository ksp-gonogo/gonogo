using Gonogo.KSP.SilenceTracking;
using Sitrep.Host.Comms;
using Xunit;

public class SilenceTrackerPersistenceTests
{
    private static SilenceTracker NewTracker() =>
        new SilenceTracker((sample, onsetUt) => new SilenceDeadline(600, "policy-ceiling"));

    [Fact]
    public void SaveThenLoadRestoresEveryFieldIncludingTheBoolAndDoubleFieldsExactly()
    {
        // A bool/double ConfigNode round-trip is easy to get wrong,
        // so this pins BOTH explicitly rather than trusting the shape alone.
        var source = NewTracker();
        source.Tick(new[] { new SilenceSample("vessel-silent", true, null, false) }, ut: 0);
        source.Tick(new[] { new SilenceSample("vessel-silent", false, null, false) }, ut: 10);

        var before = source.TryGetState("vessel-silent")!;
        Assert.Equal(SilenceState.Silent, before.State);
        Assert.False(before.Connected);

        var node = new ConfigNode("SCENARIO");
        SilenceTrackerPersistence.Save(source, node);

        var target = NewTracker();
        SilenceTrackerPersistence.Load(target, node);

        var after = target.TryGetState("vessel-silent")!;
        Assert.Equal(before.State, after.State);
        Assert.Equal(before.Connected, after.Connected);
        Assert.Equal(before.SilenceSinceUt, after.SilenceSinceUt);
        Assert.Equal(before.DeadlineUt, after.DeadlineUt);
        Assert.Equal(before.DeadlineBasis, after.DeadlineBasis);
        Assert.Equal(before.LastContactUt, after.LastContactUt);
    }

    [Fact]
    public void APredictedReturnAndItsGraceSurviveSaveAndLoad()
    {
        var source = new SilenceTracker((sample, onsetUt) =>
            new SilenceDeadline(900, SilenceDeadlineBasis.PredictedReacquisition, predictedReacquisitionUt: onsetUt + 600, predictionGraceSec: 300));
        source.Tick(new[] { new SilenceSample("vessel-behind", true, null, false) }, ut: 0);
        source.Tick(new[] { new SilenceSample("vessel-behind", false, null, false) }, ut: 10);

        var node = new ConfigNode("SCENARIO");
        SilenceTrackerPersistence.Save(source, node);
        var target = NewTracker();
        SilenceTrackerPersistence.Load(target, node);

        var after = target.TryGetState("vessel-behind")!;
        Assert.Equal(SilenceState.Silent, after.State);
        Assert.Equal(610.0, after.PredictedReacquisitionUt);
        Assert.Equal(300.0, after.PredictionGraceSec);
        Assert.Equal(SilenceDeadlineBasis.PredictedReacquisition, after.DeadlineBasis);
    }

    [Fact]
    public void SaveThenLoadRoundTripsAConnectedTrueVesselToo()
    {
        // The bool round-trip needs BOTH values pinned: a lazy encode could
        // pass on false (the CLR default) while silently mishandling true.
        var source = NewTracker();
        source.Tick(new[] { new SilenceSample("vessel-nominal", true, null, false) }, ut: 5);

        var node = new ConfigNode("SCENARIO");
        SilenceTrackerPersistence.Save(source, node);

        var target = NewTracker();
        SilenceTrackerPersistence.Load(target, node);

        var after = target.TryGetState("vessel-nominal")!;
        Assert.True(after.Connected);
        Assert.Equal(SilenceState.Nominal, after.State);
        Assert.Equal(5.0, after.LastContactUt);
    }

    [Fact]
    public void NullableFieldsRoundTripAsNullWhenNominal()
    {
        var source = NewTracker();
        source.Tick(new[] { new SilenceSample("vessel-fresh", true, null, false) }, ut: 1);

        var node = new ConfigNode("SCENARIO");
        SilenceTrackerPersistence.Save(source, node);

        var target = NewTracker();
        SilenceTrackerPersistence.Load(target, node);

        var after = target.TryGetState("vessel-fresh")!;
        Assert.Null(after.SilenceSinceUt);
        Assert.Null(after.DeadlineUt);
        Assert.Null(after.DeadlineBasis);
    }

    [Fact]
    public void LoadMergesIntoTheSameTrackerInstanceRatherThanReplacingIt()
    {
        // SilenceTrackerScenario hands this exact tracker reference to
        // SilenceTrackerSink.Bind before OnLoad runs, so Load must mutate it
        // in place, not return a different object those consumers never see.
        var target = NewTracker();
        target.Tick(new[] { new SilenceSample("pre-existing", true, null, false) }, ut: 0);

        var source = NewTracker();
        source.Tick(new[] { new SilenceSample("loaded", true, null, false) }, ut: 0);
        var node = new ConfigNode("SCENARIO");
        SilenceTrackerPersistence.Save(source, node);

        var sameInstance = target;
        SilenceTrackerPersistence.Load(target, node);

        Assert.Same(sameInstance, target);
        Assert.NotNull(target.TryGetState("pre-existing"));
        Assert.NotNull(target.TryGetState("loaded"));
    }

    [Fact]
    public void LoadOfANodeWithNoTrackerChildLeavesTheTargetUntouched()
    {
        var target = NewTracker();
        target.Tick(new[] { new SilenceSample("kept", true, null, false) }, ut: 0);

        var node = new ConfigNode("SCENARIO");
        SilenceTrackerPersistence.Load(target, node);

        Assert.NotNull(target.TryGetState("kept"));
    }

    [Fact]
    public void MultipleVesselsAllRoundTrip()
    {
        var source = NewTracker();
        source.Tick(new[]
        {
            new SilenceSample("v1", true, null, false),
            new SilenceSample("v2", false, null, false),
        }, ut: 0);

        var node = new ConfigNode("SCENARIO");
        SilenceTrackerPersistence.Save(source, node);

        var target = NewTracker();
        SilenceTrackerPersistence.Load(target, node);

        Assert.Equal(SilenceState.Nominal, target.TryGetState("v1")!.State);
        Assert.Equal(SilenceState.Silent, target.TryGetState("v2")!.State);
    }

    [Fact]
    public void ADestroyedVesselIsNotWrittenIntoTheSave()
    {
        var source = NewTracker();
        source.Tick(new[] { new SilenceSample("probe", true, null, false), new SilenceSample("debris", true, null, false) }, ut: 0);
        source.Tick(new[] { new SilenceSample("probe", true, null, false) }, ut: 10);
        Assert.True(source.TryGetState("debris")!.IsDestroyed);

        var node = new ConfigNode("SCENARIO");
        SilenceTrackerPersistence.Save(source, node);

        var target = NewTracker();
        SilenceTrackerPersistence.Load(target, node);
        Assert.NotNull(target.TryGetState("probe"));
        Assert.Null(target.TryGetState("debris"));
    }
}
