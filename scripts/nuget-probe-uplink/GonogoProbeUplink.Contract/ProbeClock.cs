using Sitrep.Contract;

namespace GonogoProbeUplink;

/// <summary>The <c>probe.clock</c> channel: the game's universal time when it was read.</summary>
[SitrepContract]
[SitrepTopic("probe.clock")]
public sealed class ProbeClock
{
    /// <summary>Universal time at the read.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? Ut { get; set; }
}
