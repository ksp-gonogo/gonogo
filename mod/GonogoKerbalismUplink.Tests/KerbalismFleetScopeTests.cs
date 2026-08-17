using System.Collections.Generic;
using Gonogo.KerbalismUplink;
using Xunit;

/// <summary>
/// The per-craft subscription gate. These are the assertions that a live check
/// cannot make: a fleet read that walks every vessel in the save renders exactly
/// the same widget as one that reads the single craft being watched, so the only
/// place the difference is visible is here.
/// </summary>
public class KerbalismFleetScopeTests
{
    [Fact]
    public void OnlyTheCraftWithASubscriberOfItsOwnAreRead()
    {
        var asked = new List<string>();
        var watched = KerbalismFleetScope.WatchedVessels(
            new[] { "alpha", "bravo", "charlie" },
            prefix =>
            {
                asked.Add(prefix);
                return prefix == "kerbalism.vessel.bravo.";
            });

        Assert.Equal(new[] { "bravo" }, watched);
        // Asked ONCE PER CRAFT, about that craft: a namespace-wide question
        // would answer "yes" for all three the moment one of them is on screen.
        Assert.Equal(
            new[] { "kerbalism.vessel.alpha.", "kerbalism.vessel.bravo.", "kerbalism.vessel.charlie." },
            asked);
        Assert.DoesNotContain(KerbalismFleetScope.Prefix, asked);
    }

    [Fact]
    public void NobodyWatchingReadsNothing()
    {
        var watched = KerbalismFleetScope.WatchedVessels(new[] { "alpha", "bravo" }, _ => false);
        Assert.Empty(watched);
    }

    [Fact]
    public void EachCraftsTopicsSitUnderItsOwnGuidSegment()
    {
        // The guid must be the segment straight after the namespace, or the
        // per-vessel node routing cannot find it and the payload silently rides
        // the active craft's light-time.
        Assert.Equal("kerbalism.vessel.abc-123.", KerbalismFleetScope.TopicPrefixFor("abc-123"));
        Assert.Equal("abc-123.lifesupport", KerbalismFleetScope.LifeSupportSubTopic("abc-123"));
        Assert.Equal("abc-123.crew", KerbalismFleetScope.CrewSubTopic("abc-123"));
    }
}
