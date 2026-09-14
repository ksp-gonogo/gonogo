using System;
using System.Linq;
using GonogoRp1Uplink;
using RP0;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
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

    /// <summary>
    /// A UT no capture could arrive at by accident, so a reading carrying it can
    /// only have asked the host for it.
    /// </summary>
    private const double HostClockUt = 987654.0;

    [Fact]
    public void A_capture_on_a_tick_with_no_snapshot_is_stamped_with_the_hosts_clock()
    {
        // It used to be stamped 0.0, and 0.0 is year 1 day 1: a real instant, so
        // the reading claimed to have been taken at the start of the game rather
        // than at a time nobody measured. The host's clock is the only instant an
        // Uplink can ask for, and this asserts the walk quotes it.
        var uplink = new Rp1ScUplink();
        SpaceCenterManagement.Instance = new SpaceCenterManagement();
        uplink.Register(new ClockedUplinkHost(HostClockUt));

        var raw = Assert.IsType<Rp1ScRaw>(uplink.CaptureOnMain(null));

        Assert.Equal(HostClockUt, raw.Ut);
    }

    [Fact]
    public void Every_space_centre_channel_is_held_at_home_and_only_presence_is_true_now()
    {
        // Space-centre state is held at the home command, so it reaches each
        // vantage after that vantage's delay to home rather than everywhere at
        // once. Asserted per channel rather than assumed, and each exception is
        // named here rather than exempted by a predicate, so neither can spread by
        // copy-paste.
        //
        // rp1.available is a fact about the install, which no place holds.
        //
        // rp1.avionics is about a craft rather than a building, so it MUST ride the
        // reveal gate on that craft's node: an operator on a delayed link reading a
        // live control state is the failure the gate exists to prevent, and this
        // one is a launch-safety readout.
        var manifest = new Rp1ScUplink().Manifest;
        Assert.Equal("rp1", manifest.Id);
        Assert.All(manifest.Channels, c => Assert.StartsWith("rp1.", c.Topic));

        var atHome = manifest.Channels
            .Where(c => c.Topic != Rp1ScUplink.AvionicsTopic && c.Topic != Rp1ScUplink.AvailableTopic)
            .ToList();
        Assert.Equal(25, atHome.Count);
        Assert.All(atHome, c =>
        {
            Assert.Equal(DelayRole.Delayed, c.Delay);
            Assert.True(c.HeldAtHome, c.Topic + " is not held at home");
        });

        var available = manifest.Channels.Single(c => c.Topic == Rp1ScUplink.AvailableTopic);
        Assert.Equal(DelayRole.TrueNow, available.Delay);
        Assert.False(available.HeldAtHome);

        var avionics = manifest.Channels.Single(c => c.Topic == Rp1ScUplink.AvionicsTopic);
        Assert.Equal(DelayRole.Delayed, avionics.Delay);
        Assert.False(avionics.HeldAtHome);
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
    public void Both_Program_channels_treat_absence_as_data()
    {
        // The one place on this Uplink where an empty ARRAY would be a lie:
        // RP-1's Program catalogue is never empty, so "[]" could only mean this
        // career has been offered nothing. Declared so the client is told there
        // is no answer rather than handed a wrong one.
        var manifest = new Rp1ScUplink().Manifest;
        var programChannels = manifest.Channels
            .Where(c => c.Topic == Rp1ScUplink.ProgramsTopic || c.Topic == Rp1ScUplink.ProgramSlotsTopic)
            .ToList();

        Assert.Equal(2, programChannels.Count);
        Assert.All(programChannels, c => Assert.True(c.AbsenceIsData));
    }

    [Fact]
    public void The_Program_capture_publishes_nothing_when_RP1s_handler_is_absent()
    {
        // The end-to-end of the same rule: capture to publish, with no handler
        // live. A bag of empty lists here would reach a client as a catalogue.
        RP0.Programs.ProgramHandler.Instance = null;
        var uplink = new Rp1ScUplink();
        uplink.Register(new ClockedUplinkHost(HostClockUt));
        var captured = uplink.CaptureProgramsOnMain(null);

        Assert.Null(captured);
        Assert.Null(Rp1ProgramsCapture.BuildPrograms(captured as Rp1ProgramsRaw));
        Assert.Null(Rp1ProgramsCapture.BuildSlots(captured as Rp1ProgramsRaw));
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
        uplink.Register(new ClockedUplinkHost(HostClockUt));
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
        uplink.Register(new ClockedUplinkHost(HostClockUt));
        uplink.CaptureOnMain(null);

        var health = uplink.Health();
        Assert.Equal(UplinkHealthState.Healthy, health.State);
        Assert.Contains(health.Facts, f => f.Label == "save mode" && f.Value == "enabled");
    }

    [Fact]
    public void A_managed_save_reads_as_healthy_before_any_capture_has_run()
    {
        // The roster is polled whether or not a client has subscribed to anything
        // of this Uplink's, and every rp1.* reading is subscription-gated: the
        // capture is skipped entirely on any tick where nobody is watching one of
        // those topics. Answering the save question out of what that capture last
        // wrote meant an unwatched RP-1 career reported itself Degraded, with
        // "RP-1 is loaded but not enabled for this save", about a save RP-1 was
        // managing the whole time.
        var uplink = new Rp1ScUplink();
        SpaceCenterManagement.Instance = new SpaceCenterManagement();

        var health = uplink.Health();

        Assert.Equal(UplinkHealthState.Healthy, health.State);
        Assert.Contains(health.Facts, f => f.Label == "save mode" && f.Value == "enabled");
    }

    [Fact]
    public void An_unmanaged_save_still_reads_as_degraded_before_any_capture_has_run()
    {
        // The contrast: reading the save state live must not turn every save into
        // a managed one. Without this, answering "enabled" unconditionally would
        // pass the case above and lose the distinction it exists to draw.
        var uplink = new Rp1ScUplink();
        SpaceCenterManagement.Instance = new SpaceCenterManagement { enabledForSave = false };

        var health = uplink.Health();

        Assert.Equal(UplinkHealthState.Degraded, health.State);
        Assert.Contains(health.Facts, f => f.Label == "save mode" && f.Value == "not enabled for this save");
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
