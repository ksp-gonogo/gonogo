using System;
using Xunit;

namespace Gonogo.KSP.Tests.CurrencyDelay
{
    /// <summary>
    /// An away science event must resolve its origin before it is allowed to
    /// call that origin unroutable.
    ///
    /// <para><b>The defect this sits in.</b> Measured live: a craft in a stable
    /// 400 km lunar orbit, loaded, with a confirmed one-hop link to an Earth
    /// station, transmitted 25 science at UT 2,821.880 and the ledger held it to
    /// UT 24,421.880. The difference is 21,600.000 to the millisecond, which is
    /// not a light-time at any scale: it is the silence-declaration deadline, the
    /// number an event gets when nothing could be found to measure. At the rig's
    /// 0.1 light-speed scale the Earth-Moon hop is worth about 13 seconds.</para>
    ///
    /// <para><b>Why nothing caught it.</b> The arm took the origin's live vessel
    /// as an optional argument and only one of its three entry points had one to
    /// pass. The other two carry a ProtoVessel, which has no CommNet connection,
    /// so they fell to an <c>Unroutable</c> literal - a decision made by not
    /// looking rather than by measuring, and one that reads at the call site as
    /// though a measurement had been attempted. Every unit test of the delay
    /// arithmetic passed throughout, because the arithmetic was never wrong.</para>
    ///
    /// <para><b>Source text, not behaviour</b>, and for the reason
    /// <see cref="CurrencyDelaySettlePumpIsWiredTests"/> sets out at length:
    /// <c>StockCurrencyInterceptor</c> needs a live scene and is not compiled
    /// into this project at all, so a text scan is the only instrument that can
    /// see it. The half that CAN be entered headlessly is exercised for real in
    /// <see cref="LiveOriginDelayTests"/>; between the two, the walk is measured
    /// and the fact that this arm reaches it is checked.</para>
    ///
    /// <para>The DELAY half of the arm's wiring, in other words.
    /// <see cref="AwayScienceArmIsWiredTests"/> is the AMOUNT half, and the two
    /// defects are independent: an arm can be told the right number and hold it
    /// for six hours, or be told zero and hold nothing at all.</para>
    /// </summary>
    public class AwayScienceOriginIsResolvedTests
    {
        [Fact]
        public void the_away_science_arm_resolves_its_origin_by_id()
        {
            var arm = AwayScienceArm();

            Assert.Contains("KscLightTime.ForVesselId", arm, StringComparison.Ordinal);
        }

        [Fact]
        public void the_away_science_arm_never_declares_an_origin_unroutable_without_looking()
        {
            var arm = AwayScienceArm();

            // Unroutable is a finding, and the only thing entitled to reach it is
            // a lookup that came back empty. Written here as a literal, it is an
            // assumption wearing a measurement's clothes.
            Assert.DoesNotContain("KscDelay.Unroutable", arm, StringComparison.Ordinal);
        }

        [Fact]
        public void the_per_increment_sink_resolves_the_same_way()
        {
            var sink = CurrencyDelaySourceText.Read("DelayedScienceSink.cs");

            Assert.Contains("KscLightTime.ForVesselId", sink, StringComparison.Ordinal);

            // It grew its own roster walk while the interceptor grew none, which
            // is how one subsystem came to hold two answers to one question and
            // ship the wrong one on the busier path.
            Assert.DoesNotContain("FlightGlobals", sink, StringComparison.Ordinal);
        }

        private static string AwayScienceArm() =>
            CurrencyDelaySourceText.MethodBody(
                CurrencyDelaySourceText.Read("StockCurrencyInterceptor.cs"),
                "private void ResolveScienceAway(");
    }
}
