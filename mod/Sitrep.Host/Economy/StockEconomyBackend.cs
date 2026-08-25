using Sitrep.Contract;

namespace Sitrep.Host.Economy
{
    /// <summary>
    /// What stock career mode does with money, stated as itself.
    ///
    /// <para>Writing this down is what proves the economy capability is a real
    /// seam rather than one mod's special case wearing a capability's costume,
    /// and it is what runs on every install without a career overhaul, which is
    /// most of them.</para>
    ///
    /// <para>The three rates are ZERO, not absent, and the distinction is the
    /// whole content of this class. Stock reputation does not decay: that is a
    /// property of the model, so zero is a true reading rather than a placeholder.
    /// Stock pays no subsidy and levies no standing cost: same. An operator
    /// reading "0/day upkeep" on a stock save has learned something correct.</para>
    ///
    /// <para>The BREAKDOWN is absent, and that is the other half of the same
    /// point. Stock has no notion of a facility bill, a researcher salary or a
    /// training cost, so seven zeros would claim it levies seven kinds of
    /// nothing where the truth is that it has none of the concepts.</para>
    /// </summary>
    public sealed class StockEconomyBackend : IEconomyBackend
    {
        public string ProviderId => "stock";

        public EconomyReading? Interpret(double ut, double? reputation) => new EconomyReading
        {
            ReputationDecayPerDay = 0.0,
            SubsidyPerDay = 0.0,
            SubsidyMinPerDay = 0.0,
            SubsidyMaxPerDay = 0.0,
            UpkeepPerDay = 0.0,
            UpkeepBreakdown = null,
        };
    }
}
