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
        // A bool/double ConfigNode round-trip has bitten this repo before,
        // so this pins BOTH explicitly rather than trusting the shape alone.
        var source = NewTracker();
        source.Tick(new[] { new SilenceSample("vessel-lost", true, null, false) }, ut: 0);
        source.Tick(new[] { new SilenceSample("vessel-lost", false, null, false) }, ut: 10);
        source.Tick(new[] { new SilenceSample("vessel-lost", false, null, false) }, ut: 700);

        var before = source.TryGetState("vessel-lost")!;
        Assert.Equal(SilenceState.Lost, before.State);
        Assert.False(before.Connected);

        var node = new ConfigNode("SCENARIO");
        SilenceTrackerPersistence.Save(source, node);

        var target = NewTracker();
        SilenceTrackerPersistence.Load(target, node);

        var after = target.TryGetState("vessel-lost")!;
        Assert.Equal(before.State, after.State);
        Assert.Equal(before.Connected, after.Connected);
        Assert.Equal(before.SilenceSinceUt, after.SilenceSinceUt);
        Assert.Equal(before.DeadlineUt, after.DeadlineUt);
        Assert.Equal(before.DeadlineBasis, after.DeadlineBasis);
        Assert.Equal(before.DeclaredLostUt, after.DeclaredLostUt);
        Assert.Equal(before.LostSeq, after.LostSeq);
        Assert.Equal(before.LastContactUt, after.LastContactUt);
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
        Assert.Null(after.DeclaredLostUt);
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
    public void RestoredSilentStateStillRequiresFreshHysteresisAfterLoad()
    {
        // End-to-end: a vessel Silent with an already-passed deadline at
        // save time must NOT be instantly Lost after Load - see
        // SilenceTracker.RestoreState's own doc comment.
        var source = NewTracker();
        source.Tick(new[] { new SilenceSample("vessel-silent", false, null, false) }, ut: 0);
        Assert.Equal(SilenceState.Silent, source.TryGetState("vessel-silent")!.State);

        var node = new ConfigNode("SCENARIO");
        SilenceTrackerPersistence.Save(source, node);

        var target = NewTracker();
        SilenceTrackerPersistence.Load(target, node);

        // "Now" is already well past the deadline that was persisted.
        target.Tick(new[] { new SilenceSample("vessel-silent", false, null, false) }, ut: 10_000);
        Assert.Equal(SilenceState.Silent, target.TryGetState("vessel-silent")!.State);

        target.Tick(new[] { new SilenceSample("vessel-silent", false, null, false) }, ut: 10_001);
        Assert.Equal(SilenceState.Lost, target.TryGetState("vessel-silent")!.State);
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
}
