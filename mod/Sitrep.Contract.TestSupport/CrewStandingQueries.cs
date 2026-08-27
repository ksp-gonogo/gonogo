using Sitrep.Contract;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// Builds a <see cref="CrewStandingQuery"/> for a test, so a case can name
    /// the one axis it is about and inherit a sane rest.
    /// </summary>
    /// <remarks>
    /// In the shared test-support assembly rather than beside each suite because
    /// the crew-standing tests live in three of them (core's election, the space
    /// centre view, RP-1's backend) and a per-suite copy is three defaults that
    /// drift. It exists at all because the query is a struct with six members and
    /// most cases care about one: spelled out at every call site, a case reads as
    /// a list of values rather than as the thing it is testing.
    /// </remarks>
    public static class CrewStandingQueries
    {
        /// <summary>Owned crew, with only the axes a case names set.</summary>
        public static CrewStandingQuery Crew(
            string name,
            KspRosterStatus rosterStatus,
            bool inactive = false,
            double? inactiveUntilUt = null,
            double ut = 0.0) =>
            new CrewStandingQuery
            {
                KerbalName = name,
                RosterStatusOrdinal = (int)rosterStatus,
                IsApplicant = false,
                Inactive = inactive,
                InactiveUntilUt = inactiveUntilUt,
                Ut = ut,
            };

        /// <summary>
        /// A hireable candidate. No roster status, because an applicant has none:
        /// a zero here would read to a backend as stock's <c>Available</c>.
        /// </summary>
        public static CrewStandingQuery Applicant(string name, double ut = 0.0) =>
            new CrewStandingQuery
            {
                KerbalName = name,
                RosterStatusOrdinal = null,
                IsApplicant = true,
                Ut = ut,
            };
    }
}
