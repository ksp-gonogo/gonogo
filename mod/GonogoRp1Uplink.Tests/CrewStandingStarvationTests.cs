using System;
using GonogoRp1Uplink;
using RP0.Crew;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Sitrep.Host.Crew;
using Xunit;

/// <summary>
/// The <c>"crewStanding"</c> capability is EXCLUSIVE, so when this Uplink wins it
/// stock does not answer underneath. It must therefore answer under the
/// subscriptions a real session holds, and here the harshest case is also the
/// COMMONEST one: a dashboard watching the crew roster and no <c>rp1.*</c> topic
/// at all.
///
/// <para><b>What this exists to catch.</b> Every <c>rp1.*</c> reading rides a
/// capture gated on this Uplink's own topics, and the engine skips a gated
/// capture entirely on any tick where nothing under its prefixes is subscribed.
/// A crew-standing backend answered out of state that capture stashed would
/// therefore go silent on exactly the dashboards that need it, and the failure is
/// invisible in the data: the roster keeps publishing, with stock's answer, and
/// stock's answer about an RP-1 retiree is "killed". An operator would be told
/// their astronauts had died because nobody happened to be watching a build
/// queue.</para>
///
/// <para>So the cases below drive ticks with the crew roster's own topic
/// subscribed and no <c>rp1.*</c> topic subscribed, and ask the ELECTION what it
/// answers rather than asking the registration whether it happened. A
/// registration-shape assertion cannot see this: the provider is registered
/// either way, and what changes is whether the instance behind it was ever
/// fed.</para>
/// </summary>
[Collection("rp0-static-graph")]
public class CrewStandingStarvationTests : IDisposable
{
    // Claimed for the census in Sitrep.Host.IntegrationTests, which discovers which
    // capabilities an Uplink can win and fails on one nothing claims. A marker
    // rather than a path, so this file can move or be renamed without the census
    // losing track of what it proves.
    //
    // exclusive-capability-starvation: crewStanding

    private const string Retiree = "Wernher Kerman";

    public CrewStandingStarvationTests() => CrewHandler.Instance = null;

    public void Dispose() => CrewHandler.Instance = null;

    [Fact]
    public void The_crew_standing_backend_answers_with_nothing_subscribed()
    {
        CrewHandler.Instance = new CrewHandler().Retired(Retiree);

        var host = Registered();
        host.DriveTicks(3, new KspSnapshot());

        var backend = CrewStandingElection.Elected(host.Kernel);
        Assert.NotNull(backend);
        Assert.Equal("rp1", backend!.ProviderId);
        Assert.Equal(
            CrewStanding.Retired,
            backend.Read(Retiree, (int)KspRosterStatus.Dead, isApplicant: false)?.Standing);
    }

    /// <summary>
    /// The same reading with the Uplink's own topics watched. Paired with the case
    /// above so a green there is a claim about the SUBSCRIPTIONS and not about
    /// RP-1 being absent from the fixture: if the fixture were the reason, both
    /// would answer null and neither would say so.
    /// </summary>
    [Fact]
    public void The_crew_standing_backend_answers_the_same_with_its_topics_watched()
    {
        CrewHandler.Instance = new CrewHandler().Retired(Retiree);

        var host = Registered();
        host.DriveTicks(3, new KspSnapshot(), Rp1ScUplink.CrewTopic);

        var watched = CrewStandingElection.Elected(host.Kernel)
            ?.Read(Retiree, (int)KspRosterStatus.Dead, isApplicant: false);
        Assert.Equal(CrewStanding.Retired, watched?.Standing);
    }

    /// <summary>
    /// The backend answers BEFORE any tick has run at all, which is the state
    /// core's first space-centre capture arrives in. A backend that needed a tick
    /// would report the first roster of every session as a list of fatalities.
    /// </summary>
    [Fact]
    public void The_crew_standing_backend_answers_before_the_first_tick()
    {
        CrewHandler.Instance = new CrewHandler().Retired(Retiree);

        var host = Registered();

        Assert.Equal(
            CrewStanding.Retired,
            CrewStandingElection.Elected(host.Kernel)?.Read(Retiree, (int)KspRosterStatus.Dead, isApplicant: false)?.Standing);
    }

    /// <summary>
    /// A retirement that happens BETWEEN ticks reaches the next roster, because
    /// the backend queries RP-1's live set rather than a copy taken at capture
    /// time. A cached answer would keep a fresh retiree reading as a fatality for
    /// as long as nothing of ours was subscribed, which is indefinitely.
    /// </summary>
    [Fact]
    public void A_retirement_between_ticks_reaches_the_next_read()
    {
        var handler = new CrewHandler();
        CrewHandler.Instance = handler;

        var host = Registered();
        host.DriveTicks(2, new KspSnapshot());
        var backend = CrewStandingElection.Elected(host.Kernel);

        Assert.Null(backend!.Read(Retiree, (int)KspRosterStatus.Dead, isApplicant: false));

        handler.Retired(Retiree);

        Assert.Equal(
            CrewStanding.Retired,
            backend.Read(Retiree, (int)KspRosterStatus.Dead, isApplicant: false)?.Standing);
    }

    /// <summary>
    /// The capability declared the way core declares it, the Uplink registered,
    /// the election run. Declared through <see cref="CrewStandingElection"/> itself
    /// rather than a copy of its descriptor, so a change to how core declares the
    /// capability reaches this test instead of drifting away from it.
    /// </summary>
    private static StarvationProbeHost Registered()
    {
        var kernel = new Kernel();
        CrewStandingElection.RegisterCapability(kernel);
        var host = new StarvationProbeHost(kernel);
        new Rp1ScUplink().Register(host);
        host.Resolve();
        return host;
    }
}
