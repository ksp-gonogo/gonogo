namespace Sitrep.Contract
{
    /// <summary>The exclusive capability id every economy backend competes for.</summary>
    /// <remarks>
    /// Declared here so the election and a registering Uplink spell it from one
    /// constant, the same shape as <see cref="CrewStandingCapability"/> and
    /// <see cref="ActionGroupsCapability"/>.
    /// </remarks>
    /// <category>Uplink API</category>
    public static class EconomyCapability
    {
        /// <summary>The capability id, <c>"economy"</c>: register an <see cref="IEconomyBackend"/> under exactly this string.</summary>
        public const string Id = "economy";
    }

    /// <summary>
    /// One backend's reading of what a career's money is doing. Plain data, no
    /// KSP and no game types, so this assembly stays KSP-free and a backend can
    /// be exercised headless.
    /// </summary>
    /// <remarks>
    /// Every member is nullable and every null means the SAME thing: this backend
    /// does not model that quantity. A zero means it models it and the value is
    /// zero, which for stock is the truth about decay, subsidy and upkeep alike.
    /// Not a wire type: this is the shape a backend returns, and core folds it
    /// into <c>career.status</c>'s <c>economy</c> group
    /// (<see cref="CareerEconomy"/>).
    /// </remarks>
    /// <category>Uplink API</category>
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
        /// Where the upkeep goes: the parts <see cref="UpkeepPerDay"/> is made
        /// of, and they sum to it. Null when the backend has no per-source model,
        /// which is the truthful value for stock rather than seven zeros.
        /// </summary>
        /// <remarks>
        /// A DECOMPOSITION, which is a stronger promise than "seven costs". A
        /// money model whose total is stated after some modifier its parts are
        /// stated before does not have one, and a backend in that position must
        /// put the modified parts here and the unmodified ones in
        /// <see cref="UpkeepBeforeModifiers"/>. If it cannot produce the modified
        /// parts it leaves this null: a set that does not add up to the total
        /// beside it is worse than no set at all, because a reader has no way to
        /// tell which of the two lied.
        /// </remarks>
        public EconomyUpkeepBreakdown? UpkeepBreakdown { get; set; }

        /// <summary>
        /// The same sources, priced BEFORE whatever the model does to them at
        /// transaction time: leaders, strategies, standing discounts. Null when
        /// the model applies nothing, which is true of stock and of any model
        /// whose two sets would be identical.
        /// </summary>
        /// <remarks>
        /// Carried beside <see cref="UpkeepBreakdown"/> rather than instead of it
        /// because the two serve different questions and an operator has both.
        /// The modified set says what the programme is reported to cost; this one
        /// says what it costs before the career's current arrangements are
        /// applied, so the difference between them is what those arrangements are
        /// worth. It is also the set that survives when the model can state its
        /// own costs but cannot price them.
        /// </remarks>
        public EconomyUpkeepBreakdown? UpkeepBeforeModifiers { get; set; }

        /// <summary>
        /// A prepaid allowance, denominated in funds, that this money model
        /// consumes BEFORE funds on the purchases it applies to. Null when the
        /// model has no such pool, as on stock.
        /// </summary>
        /// <remarks>
        /// A balance, never an affordability verdict. What a given purchase will
        /// actually draw from it is a per-purchase question the model settles with
        /// a currency-modifier query, and a query broadcasts to every modifier in
        /// the save: a thing to run at the moment an operator commits, not a thing
        /// to sample. So a client reads this beside the funds balance and shows
        /// both, rather than trying to reconstruct the split from a list price.
        /// </remarks>
        public double? UnlockCredit { get; set; }
    }

    /// <summary>
    /// Upkeep by source, per day. Every member nullable for the same reason as
    /// <see cref="EconomyReading"/>'s: a source this backend does not model is
    /// absent, not zero.
    /// </summary>
    /// <category>Uplink API</category>
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
    ///
    /// <para>Reputation is a number every career mode has and stock treats as a
    /// score. A career-overhaul mod can make it an income: reputation decays
    /// daily and sets a funding subsidy, against which a continuous per-day
    /// upkeep runs. This capability does NOT replace the reading:
    /// <c>career.status.economy.reputation</c> keeps publishing the stock field
    /// unchanged. The backend INTERPRETS a value core already owns, which is why
    /// it is handed the reputation rather than reading it.</para>
    ///
    /// <para>Core supplies a stock backend, which is a real reader and not a
    /// no-op: stock has no decay, no subsidy and no ongoing cost, and says so
    /// with zeros. What stock has no CONCEPT of is the per-source breakdown, so
    /// that stays null. An overhaul mod registers its own provider from its
    /// Uplink's registration, gated by its own presence probe. The elected
    /// backend's <see cref="ISitrepProvider.ProviderId"/> is published as
    /// <see cref="CareerEconomy.EconomyModel"/>.</para>
    ///
    /// <para><b>Threading.</b> <see cref="Interpret"/> is called OFF the main
    /// thread. It may read an overhaul's own scenario state, but must not call
    /// anything that touches Unity or broadcasts a game event; a value that
    /// needs one is captured on the main thread by the backend's own Uplink and
    /// only read here.</para>
    /// <internal>
    /// Called from <c>Gonogo.KSP.KspHost.BuildCareerEconomy</c>, reached from
    /// the <c>career.status</c> channel mapper on the Courier thread. RP-1's
    /// per-line upkeep pricing broadcasts a game event, which is why the RP-1
    /// Uplink samples it on the main thread.
    /// </internal>
    /// </summary>
    /// <category>Uplink API</category>
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
        /// returns what it can without it.
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
