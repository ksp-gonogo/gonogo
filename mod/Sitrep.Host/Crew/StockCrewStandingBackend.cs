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
    /// <para>The map itself is <see cref="CrewStandings.FromRosterStatus"/>, in
    /// the contract, because a mod backend needs the same default for every
    /// kerbal it declines to correct and cannot reference this assembly.</para>
    ///
    /// <para>Stock has no <see cref="CrewStanding.Retired"/> and never reports
    /// it. A career under stock rules ends one way, and saying so is truthful
    /// rather than a gap.</para>
    /// </summary>
    public sealed class StockCrewStandingBackend : ICrewStandingBackend
    {
        public string ProviderId => "stock";

        public CrewStandingReading? Read(string kerbalName, int? rosterStatusOrdinal, bool isApplicant) =>
            new CrewStandingReading
            {
                Standing = CrewStandings.FromRosterStatus(rosterStatusOrdinal, isApplicant),
            };
    }
}
