using System;
using GonogoRp1Uplink;
using RP0;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Sitrep.Host.Economy;
using Xunit;

/// <summary>
/// The <c>"economy"</c> capability is EXCLUSIVE, so when this Uplink wins it stock
/// does not answer underneath. It must therefore answer under the subscriptions a
/// real session holds, and the honest case is the harshest one: nobody watching
/// anything.
///
/// <para><b>What this exists to catch.</b> Every <c>rp1.*</c> reading this Uplink
/// publishes rides a capture gated on those nine topics, and the engine skips a
/// gated capture entirely on any tick where nothing under its prefixes is
/// subscribed. That is safe only while nothing derives from the capture. It stopped
/// being safe once <c>_enabledForSave</c> was answered out of it: an unwatched
/// career reported itself Degraded about a save RP-1 was managing the whole time.
/// The economy provider is one field-move away from the same failure, so the case
/// below drives ticks with nothing subscribed and asks the ELECTION what it
/// answers, rather than asking the registration whether it happened.</para>
///
/// <para>A registration-shape assertion cannot see this. The provider is registered
/// either way; what changes is whether the instance behind it was ever fed.</para>
/// </summary>
[Collection("rp0-static-graph")]
public class EconomyStarvationTests : IDisposable
{
    // Claimed for the census in Sitrep.Host.IntegrationTests, which discovers which
    // capabilities an Uplink can win and fails on one nothing claims. A marker
    // rather than a path, so this file can move or be renamed without the census
    // losing track of what it proves.
    //
    // exclusive-capability-starvation: economy

    public EconomyStarvationTests()
    {
        SpaceCenterManagement.Instance = null;
        MaintenanceHandler.Instance = null;
    }

    public void Dispose()
    {
        SpaceCenterManagement.Instance = null;
        MaintenanceHandler.Instance = null;
    }

    [Fact]
    public void The_economy_backend_answers_with_nothing_subscribed()
    {
        SpaceCenterManagement.Instance = new SpaceCenterManagement();
        MaintenanceHandler.Instance = new MaintenanceHandler();

        var host = Registered();
        host.DriveTicks(3, new KspSnapshot());

        var backend = EconomyElection.Elected(host.Kernel);
        Assert.NotNull(backend);
        Assert.Equal("rp1", backend!.ProviderId);
        Assert.NotNull(backend.Interpret(0.0, 100.0));
    }

    /// <summary>
    /// The same reading with the Uplink's own topics watched. Paired with the case
    /// above so that a green there is a claim about the SUBSCRIPTIONS and not about
    /// RP-1 being absent from the fixture: if the fixture were the reason, both
    /// would answer null and neither would say so.
    /// </summary>
    [Fact]
    public void The_economy_backend_answers_the_same_with_its_topics_watched()
    {
        SpaceCenterManagement.Instance = new SpaceCenterManagement();
        MaintenanceHandler.Instance = new MaintenanceHandler();

        var host = Registered();
        host.DriveTicks(3, new KspSnapshot(), Rp1ScUplink.CentresTopic);

        var watched = EconomyElection.Elected(host.Kernel)?.Interpret(0.0, 100.0);
        Assert.NotNull(watched);
    }

    /// <summary>
    /// The capability declared the way core declares it, the Uplink registered, the
    /// election run. Declared through <see cref="EconomyElection"/> itself rather
    /// than a copy of its descriptor, so a change to how core declares the
    /// capability reaches this test instead of drifting away from it.
    /// </summary>
    private static StarvationProbeHost Registered()
    {
        var kernel = new Kernel();
        EconomyElection.RegisterCapability(kernel);
        var host = new StarvationProbeHost(kernel);
        new Rp1ScUplink().Register(host);
        host.Resolve();
        return host;
    }
}
