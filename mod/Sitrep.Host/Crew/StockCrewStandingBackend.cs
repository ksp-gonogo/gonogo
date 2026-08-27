using Sitrep.Contract;

namespace Sitrep.Host.Crew
{
    /// <summary>
    /// What stock KSP's roster status means, stated as itself: the whole of
    /// stock's crew model, and the reading that runs on every install without a
    /// career overhaul.
    ///
    /// <para>Not a no-op. It is a real reader whose answer happens to be a
    /// one-to-one map, and it is deliberately the capability's Vanilla rather
    /// than a special case inside the view provider: with the mapping behind the
    /// SPI, there is exactly ONE place a standing is decided and the provider
    /// never holds two derivations that could disagree.</para>
    ///
    /// <para>The map itself is <see cref="CrewStandings.FromQuery"/>, in the
    /// contract, because a mod backend needs the same default for every kerbal it
    /// declines to correct and cannot reference this assembly. It reads every axis
    /// stock exposes, not just the roster status: a kerbal standing down is
    /// <see cref="CrewStanding.Resting"/>, which is stock's own field answered by
    /// stock's own backend.</para>
    ///
    /// <para>Stock has no <see cref="CrewStanding.Retired"/> and never reports
    /// it. A career under stock rules ends one way, and saying so is truthful
    /// rather than a gap.</para>
    /// </summary>
    public sealed class StockCrewStandingBackend : ICrewStandingBackend
    {
        public string ProviderId => CrewStandings.StockSource;

        /// <summary>
        /// Answers the standing and nothing else. Availability, the wording and
        /// the stand-down's end are all left null on purpose: they are derived
        /// from the standing by <see cref="CrewStandings.Resolve"/>, and a backend
        /// that restates a derivation is a second copy of it.
        /// </summary>
        public CrewStandingReading? Read(CrewStandingQuery query) =>
            new CrewStandingReading { Standing = CrewStandings.FromQuery(query) };
    }
}
