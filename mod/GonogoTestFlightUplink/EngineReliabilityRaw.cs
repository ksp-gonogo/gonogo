// mod/GonogoTestFlightUplink/EngineReliabilityRaw.cs
// Plain per-engine reliability snapshot the reflection layer produces and the
// pure mapper consumes. KSP-FREE by design so the headless Tests project can
// compile it alongside TestFlightReliabilityMap without a KSP reference.
namespace GonogoTestFlightUplink
{
    /// <summary>
    /// One TestFlight core module's readings. EVERY field is nullable and every
    /// one starts null.
    ///
    /// <para>That is the whole point of the type. The previous version carried
    /// non-null defaults (<c>CurrentReliability = 1.0</c>, <c>MomentaryFailureRate
    /// = 0</c>) which the reflection layer's <c>?? 1.0</c> / <c>?? 0</c> coalesces
    /// filled in whenever a read failed, and since three of the four members it
    /// reflected for do not exist in any TestFlight assembly, every read failed:
    /// the wire reported "modelled, all nominal, worst engine 100%" for every
    /// craft, at an election priority that outranked Kerbalism. A substituted
    /// default is indistinguishable from a reading, so there are none here.</para>
    /// </summary>
    public sealed class EngineReliabilityRaw
    {
        public string PartId = "";
        public string? Title;
        /// <summary>The ACTIVE engine config's alias. An RO part carries many configs and the part title is not the flying identity.</summary>
        public string? Configuration;
        /// <summary>ITestFlightCore.GetPartStatus(): 0 when nothing is failed, non-zero when something is. Null when the member did not bind or the call threw.</summary>
        public int? PartStatus;
        /// <summary>Flight-data maturity in du (0 to maxData, 10000 under RO): how far up the reliability curve this config has climbed.</summary>
        public double? FlightData;
        /// <summary>Sum over the part's reliability modules of GetBaseFailureRate(LIVE flight data), per second.</summary>
        public double? BaseFailureRate;
        public double? RatedContinuousSeconds;
        public double? RunContinuousSeconds;
        public double? RatedCumulativeSeconds;
        public double? RunCumulativeSeconds;
        /// <summary>Active failures' own titles, joined. Null when there are none or the list could not be read.</summary>
        public string? FailureTitles;
        /// <summary>
        /// P(survive <see cref="SurvivalHorizonSeconds"/> seconds of operation),
        /// asked of TestFlight's OWN <c>FailureRateToReliability</c> at the LIVE
        /// base failure rate rather than reimplemented here, so the two cannot
        /// disagree about the exponential. Null whenever either input is missing.
        /// </summary>
        public double? Survival;
        /// <summary>The horizon <see cref="Survival"/> is over: the cumulative rated burn time, which is the horizon TestFlight's own GUI quotes reliability at.</summary>
        public double? SurvivalHorizonSeconds;
    }

    /// <summary>
    /// Which TestFlight members the binder actually resolved this session, carried
    /// to the wire in the provider's extension namespace.
    ///
    /// <para>It is the provenance record: an install that regresses the binder
    /// (a renamed member, a moved type) becomes visible in a debug surface without
    /// another decompile, which is exactly what was missing when three
    /// non-existent method names shipped and nothing said so.</para>
    /// </summary>
    public sealed class TestFlightBindingReport
    {
        public string[] Bound = System.Array.Empty<string>();
        public string[] Unbound = System.Array.Empty<string>();
    }
}
