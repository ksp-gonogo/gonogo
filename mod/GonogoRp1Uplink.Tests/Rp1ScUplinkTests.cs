using System;
using System.Linq;
using GonogoRp1Uplink;
using RP0;
using Sitrep.Contract;
using Xunit;

/// <summary>
/// The Uplink itself: what it declares, and what it says about its own health.
/// The degrade path is the one that will actually run on most installs and is
/// therefore the one most worth testing.
/// </summary>
[Collection("rp0-static-graph")]
public class Rp1ScUplinkTests : IDisposable
{
    public Rp1ScUplinkTests()
    {
        SpaceCenterManagement.Instance = null;
        Confidence.Instance = null;
    }

    public void Dispose()
    {
        SpaceCenterManagement.Instance = null;
        Confidence.Instance = null;
    }

    [Fact]
    public void Every_channel_is_a_ground_fact_delivered_now()
    {
        // Space-centre state has no analogue in flight, so none of it rides the
        // light-time delay clock. Asserted rather than assumed: a channel that
        // drifted to Delayed would go quiet on a disconnect for no reason.
        var manifest = new Rp1ScUplink().Manifest;
        Assert.Equal("rp1", manifest.Id);
        Assert.All(manifest.Channels, c => Assert.Equal(DelayRole.TrueNow, c.Delay));
        Assert.All(manifest.Channels, c => Assert.StartsWith("rp1.", c.Topic));
    }

    [Fact]
    public void The_two_singleton_channels_treat_absence_as_data()
    {
        // Without this a stock install leaves both unborn, and the client waits
        // forever for a value that is never coming instead of being told so.
        var manifest = new Rp1ScUplink().Manifest;
        var singletons = manifest.Channels
            .Where(c => c.Topic == Rp1ScUplink.PersonnelTopic || c.Topic == Rp1ScUplink.ConfidenceTopic)
            .ToList();

        Assert.Equal(2, singletons.Count);
        Assert.All(singletons, c => Assert.True(c.AbsenceIsData));
    }

    [Fact]
    public void Health_names_which_RP1_it_was_read_against()
    {
        // The version caveat made operable: RP-1 ships monthly, this Uplink is
        // locked to one build's disassembly, and an operator reporting an empty
        // build queue should be able to quote a row rather than guess.
        var facts = new Rp1ScUplink().Health().Facts;

        Assert.Contains(facts, f => f.Label == "RP0 assembly");
        Assert.Contains(facts, f => f.Label == "SpaceCenterManagement");
        Assert.Contains(facts, f => f.Label == "Confidence");
        Assert.Contains(facts, f => f.Label == "save mode");
        Assert.Contains(facts, f => f.Label == "read against" && f.Value == "RP-1 v4.6.0.0");
    }

    [Fact]
    public void A_save_RP1_does_not_manage_reads_as_degraded_rather_than_unavailable()
    {
        // RP-1 is installed and this Uplink is working; the save simply is not
        // one RP-1 manages. Reporting that as Unavailable would send an operator
        // looking for a missing mod.
        var uplink = new Rp1ScUplink();
        SpaceCenterManagement.Instance = new SpaceCenterManagement { enabledForSave = false };
        uplink.CaptureOnMain(null);

        var health = uplink.Health();
        Assert.Equal(UplinkHealthState.Degraded, health.State);
        Assert.Contains(health.Facts, f => f.Label == "save mode" && f.Value == "not enabled for this save");
    }

    [Fact]
    public void A_managed_save_reads_as_healthy()
    {
        var uplink = new Rp1ScUplink();
        SpaceCenterManagement.Instance = new SpaceCenterManagement();
        uplink.CaptureOnMain(null);

        var health = uplink.Health();
        Assert.Equal(UplinkHealthState.Healthy, health.State);
        Assert.Contains(health.Facts, f => f.Label == "save mode" && f.Value == "enabled");
    }

    [Fact]
    public void The_courier_half_ignores_a_capture_it_did_not_produce()
    {
        // Fail-soft, because a throw here takes the whole Uplink inert from the
        // next tick.
        var uplink = new Rp1ScUplink();
        uplink.HandleOnCourier(null);
        uplink.HandleOnCourier("not a capture");
    }
}

/// <summary>
/// RP-1's entry points are statics, so the two suites that install a stand-in
/// graph share one collection rather than racing each other.
/// </summary>
[CollectionDefinition("rp0-static-graph", DisableParallelization = true)]
public class Rp0StaticGraphCollection
{
}
