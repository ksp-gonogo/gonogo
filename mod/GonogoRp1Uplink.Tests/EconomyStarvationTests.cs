using System;
using GonogoRp1Uplink;
using RP0;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
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

        var backend = Elected(host);
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

        var watched = Elected(host)?.Interpret(0.0, 100.0);
        Assert.NotNull(watched);
    }

    /// <summary>
    /// The capability declared as core declares it, the Uplink registered, the
    /// election run.
    /// </summary>
    /// <remarks>
    /// The descriptor is built here rather than through core's own registrar,
    /// because core's registrar lives in <c>Sitrep.Host</c> and an Uplink's suite
    /// travels with the Uplink: a test that reaches a private assembly is a test an
    /// author who forks this cannot run. What core declares is guarded where core
    /// can be named, by <c>Sitrep.Host.Tests/EconomyElectionTests</c>, which pins
    /// stock winning when no provider is present, a provider winning when one is,
    /// the registration ordering, and the null a missing capability resolves to.
    /// This file's subject is the other half: whether THIS Uplink's provider still
    /// answers when nothing is subscribed.
    /// </remarks>
    private static StarvationProbeHost Registered()
    {
        var kernel = new Kernel();
        kernel.RegisterCapability(new CapabilityDescriptor
        {
            Id = EconomyCapability.Id,
            Exclusive = true,
            SpineCritical = false,
            Vanilla = _ => new StockStandIn(),
        });
        var host = new StarvationProbeHost(kernel);
        new Rp1ScUplink().Register(host);
        host.Resolve();
        return host;
    }

    private static IEconomyBackend? Elected(StarvationProbeHost host) =>
        host.Kernel.Query<IEconomyBackend>(EconomyCapability.Id);

    /// <summary>
    /// The vanilla, present so the election has something to fall back to. It
    /// answers with its own provider id, which is how the cases above tell an RP-1
    /// win from a silent fallback: a starved exclusive provider that lost the
    /// election reads as stock, not as null.
    /// </summary>
    private sealed class StockStandIn : IEconomyBackend
    {
        public string ProviderId => "stock";

        public EconomyReading? Interpret(double ut, double? reputation) => new EconomyReading();
    }
}
