namespace Gonogo.KSP.Career
{
    /// <summary>
    /// What a career spend costs, and whether it can be met.
    ///
    /// <para>Every method takes a <c>CurrencyModifierQuery</c> rather than a
    /// price and a balance, and that is the point of the type. Stock never
    /// compares a raw balance to a sticker price: it runs the query, whose
    /// modifier chain an active strategy joins to discount or surcharge one
    /// <c>TransactionReasons</c>. Taking the query means a caller cannot ask
    /// this question from anywhere but the authority that answers it.</para>
    ///
    /// <para>Separate from <see cref="CareerRefusals"/> because this is not a
    /// rule over numbers we hold; it is a question only KSP can answer.</para>
    /// </summary>
    public static class CareerAffordability
    {
        /// <summary>
        /// The query for one spend: <paramref name="cost"/> in
        /// <paramref name="currency"/>, run through the game's modifier chain.
        ///
        /// <para>A cost is a NEGATIVE delta to the query, which is how stock
        /// phrases it (<c>RunQuery(RnDTechResearch, 0f, -scienceCost, 0f)</c>),
        /// so the sign convention lives here once instead of at three call
        /// sites.</para>
        /// </summary>
        public static CurrencyModifierQuery Price(TransactionReasons reason, Currency currency, double cost)
        {
            var spend = -(float)cost;
            return CurrencyModifierQuery.RunQuery(
                reason,
                currency == Currency.Funds ? spend : 0f,
                currency == Currency.Science ? spend : 0f,
                currency == Currency.Reputation ? spend : 0f);
        }

        /// <summary>
        /// What the spend actually costs, as a positive amount: the modified
        /// total, which is the number <see cref="CanAfford"/> compares and the
        /// number an operator is charged.
        ///
        /// <para><c>GetTotal</c>, not <c>GetInput</c>. <c>GetInput</c> is the
        /// sticker price before the chain ran, so reading it makes an active
        /// cost-modifying strategy invisible and the answer wrong in both
        /// directions: refusing a discounted spend that is affordable, and
        /// allowing a surcharged one that is not.</para>
        /// </summary>
        public static double PriceOf(CurrencyModifierQuery query, Currency currency)
        {
            return -query.GetTotal(currency);
        }

        /// <summary>
        /// Whether the balance covers the spend, asked of the game rather than
        /// worked out here: <c>CurrencyModifierQuery.CanAfford(Currency)</c> is
        /// what <c>RDTech.ResearchTech</c> and <c>SpaceCenterBuilding.UpgradeFacility</c>
        /// both call, and it compares the MODIFIED total against the live
        /// balance.
        /// </summary>
        public static bool CanAfford(CurrencyModifierQuery query, Currency currency)
        {
            return query.CanAfford(currency);
        }
    }
}
