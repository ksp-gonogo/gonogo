namespace Sitrep.Contract
{
    // ─────────────────────────────────────────────────────────────────────────
    // The economy capability: what a career's reputation MEANS.
    //
    // Reputation is a number every career mode has and stock treats as a score.
    // A career-overhaul mod can make it an income: reputation decays daily and
    // sets a funding subsidy, against which a continuous per-day upkeep runs. So
    // the same field, correctly read, is either a score or a salary depending on
    // what is installed, and nothing on the wire said which.
    //
    // This capability does NOT replace the reading. `career.status.economy
    // .reputation` keeps publishing the same stock field unchanged, because the
    // value was never wrong: what was missing is the context that makes it
    // legible. So the capability INTERPRETS a reading core already owns, which is
    // a different shape from the other elections in this contract, and the
    // interface says so by taking the reputation as an argument rather than
    // reading it.
    //
    //   • ONE exclusive capability "economy" whose active instance is an
    //     IEconomyBackend.
    //   • A core registrar owns the capability, supplies the stock backend as its
    //     Vanilla factory, and folds the elected backend's answer into the
    //     career.status.economy group it already publishes.
    //   • An overhaul mod registers a provider from its OWN uplink's Register,
    //     gated by its own presence probe: registering IS the gate.
    //
    // ── Why the vanilla backend is not a no-op ───────────────────────────────
    // Stock career genuinely has no decay and no subsidy and levies no ongoing
    // cost. Saying so is a truthful answer rather than an invented one, and it is
    // the same shape the ISRU capability's stock backend has: a real reader whose
    // answer happens to be simple. What stock has no CONCEPT of is the per-source
    // breakdown, so that stays absent rather than arriving as a bag of zeros.
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// One backend's reading of what a career's money is doing. Plain data, no
    /// KSP and no game types, so this assembly stays KSP-free and a backend can
    /// be exercised headless.
    /// </summary>
    /// <remarks>
    /// Every member is nullable and every null means the SAME thing: this backend
    /// does not model that quantity. A zero means it models it and the answer is
    /// zero, which for stock is the truth about decay, subsidy and upkeep alike.
    /// Not a wire type: the wire keys are built by the career view provider, and
    /// this is the SPI shape a backend answers in.
    /// </remarks>
    public sealed class EconomyReading
    {
        /// <summary>
        /// Reputation lost per day at the CURRENT reputation. An absolute loss
        /// rather than the portion it is derived from, because the operator's
        /// question is how much they are about to lose.
        /// </summary>
        public double? ReputationDecayPerDay { get; set; }

        /// <summary>Funding this reputation currently earns, per day.</summary>
        public double? SubsidyPerDay { get; set; }

        /// <summary>The subsidy at zero reputation: the floor nothing takes away.</summary>
        public double? SubsidyMinPerDay { get; set; }

        /// <summary>
        /// The subsidy reputation cannot beat. Together with the minimum it says
        /// how much of the range the current reputation has bought, which is what
        /// makes a bare reputation number actionable.
        /// </summary>
        public double? SubsidyMaxPerDay { get; set; }

        /// <summary>
        /// Total ongoing cost per day. THE reason a funds balance is not an
        /// affordability test under an overhaul: a balance that covers a purchase
        /// today may not cover it plus next month's salaries.
        /// </summary>
        public double? UpkeepPerDay { get; set; }

        /// <summary>
        /// Where the upkeep goes. Null when the backend has no per-source model,
        /// which is the honest answer for stock rather than seven zeros.
        /// </summary>
        public EconomyUpkeepBreakdown? UpkeepBreakdown { get; set; }
    }

    /// <summary>
    /// Upkeep by source, per day. Every member nullable for the same reason as
    /// <see cref="EconomyReading"/>'s: a source this backend does not model is
    /// absent, not zero.
    /// </summary>
    public sealed class EconomyUpkeepBreakdown
    {
        /// <summary>Buildings: the standing cost of having a space centre at all.</summary>
        public double? Facilities { get; set; }

        /// <summary>Launch complexes and their pads, which cost whether or not anything is building.</summary>
        public double? LaunchComplexes { get; set; }

        /// <summary>Researcher salaries, which an idle research queue does not stop.</summary>
        public double? ResearchSalary { get; set; }

        /// <summary>Crew training in progress.</summary>
        public double? Training { get; set; }

        /// <summary>Standing crew costs: everyone on the roster, flying or not.</summary>
        public double? CrewBase { get; set; }

        /// <summary>The extra a crew in flight costs over a crew on the ground.</summary>
        public double? CrewInFlight { get; set; }

        /// <summary>Engineer salaries on the integration teams.</summary>
        public double? IntegrationSalary { get; set; }
    }

    /// <summary>
    /// The active instance of the exclusive <c>"economy"</c> capability: what this
    /// install's money model makes of a reputation reading.
    /// </summary>
    public interface IEconomyBackend : ISitrepProvider
    {
        /// <summary>
        /// Interpret the career's economy as of <paramref name="ut"/>, at
        /// <paramref name="reputation"/>.
        /// </summary>
        /// <param name="ut">
        /// Universal time. Passed in rather than read because a subsidy model can
        /// be calendar-dependent (a programme's funding ramps over its era), and
        /// because this assembly has no clock.
        /// </param>
        /// <param name="reputation">
        /// The reputation core already read, or null when it could not be read.
        /// Passed in rather than read for the reason this capability exists: the
        /// value is not in dispute, only what it MEANS. A backend handed null
        /// answers what it can without it.
        /// </param>
        /// <returns>
        /// The reading, or null when nothing can be said this tick. Null is not
        /// "no economy": every member of the reading is independently nullable,
        /// so a backend that models one quantity and not another says exactly
        /// that.
        /// </returns>
        EconomyReading? Interpret(double ut, double? reputation);
    }
}
