using Sitrep.Host.Comms;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// How the home centre judges a craft. The forecast's deadline is in the
    /// craft's own time, so home waits past it for as long as word of contact
    /// made before it could still be on its way home, and declares a craft lost
    /// only when two judgements in a row find it past that wait.
    /// </summary>
    public class HomeJudgementTests
    {
        private const string Craft = "vessel:probe";

        /// <summary>The ground lost the craft at 1000 and expects to declare it at 4000, in the craft's own time.</summary>
        private static readonly CraftForecast Forecast = new CraftForecast(Craft, 1000.0, 1000.0, 4000.0, SilenceDeadlineBasis.PolicyCeiling, null, null);

        private const double Allowance = 600.0;

        private static CentreContact Silent(double last = 999.0) => new CentreContact(CentreContactState.Silent, last);

        private static readonly CentreContact InContact = new CentreContact(CentreContactState.InContact, 5000.0);

        private static HomeVerdict Judged(params double[] uts)
        {
            var verdict = new HomeVerdict { Id = Craft };
            foreach (var ut in uts)
            {
                HomeJudgement.Judge(verdict, Silent(), Forecast, Allowance, ut);
            }
            return verdict;
        }

        /// <summary>A craft that came back just before its deadline is still being heard of on the way home when home's clock passes the deadline.</summary>
        [Fact]
        public void HomeWaitsPastTheDeadlineForAsLongAsWordOfContactCouldStillBeOnItsWay()
        {
            var verdict = Judged(4000.0, 4001.0, 4599.0);

            Assert.Equal(HomeVerdictState.Silent, verdict.State);
            Assert.Equal(0, verdict.LostSeq);
        }

        [Fact]
        public void TwoJudgementsInARowPastTheWaitDeclareTheCraftLost()
        {
            var once = Judged(4600.0);
            Assert.Equal(HomeVerdictState.Silent, once.State);

            var twice = Judged(4600.0, 4601.0);
            Assert.Equal(HomeVerdictState.Lost, twice.State);
            Assert.Equal(4601.0, twice.DeclaredLostUt);
            Assert.Equal(1, twice.LostSeq);
        }

        [Fact]
        public void ADeclarationIsMadeOnceHoweverLongTheSilenceLasts()
        {
            var verdict = Judged(4600.0, 4601.0, 5000.0, 90_000.0);

            Assert.Equal(1, verdict.LostSeq);
            Assert.Equal(4601.0, verdict.DeclaredLostUt);
        }

        [Fact]
        public void AJudgementInsideTheWaitStartsTheCountAgain()
        {
            var verdict = new HomeVerdict { Id = Craft };
            HomeJudgement.Judge(verdict, Silent(), Forecast, Allowance, 4600.0);
            HomeJudgement.Judge(verdict, InContact, Forecast, Allowance, 4601.0);
            HomeJudgement.Judge(verdict, Silent(), Forecast, Allowance, 4602.0);

            Assert.Equal(HomeVerdictState.Silent, verdict.State);
        }

        /// <summary>Word of contact withdraws a declaration, and the withdrawal is kept beside it so the penalty that landed on it can be refunded.</summary>
        [Fact]
        public void ContactAfterADeclarationWithdrawsItAndKeepsItsNumber()
        {
            var verdict = Judged(4600.0, 4601.0);

            Assert.True(HomeJudgement.Judge(verdict, InContact, Forecast, Allowance, 6000.0));

            Assert.Equal(HomeVerdictState.Nominal, verdict.State);
            Assert.Equal(1, verdict.LostSeq);
            Assert.Equal(4601.0, verdict.DeclaredLostUt);
            Assert.Equal(6000.0, verdict.WithdrawnUt);

            HomeJudgement.Judge(verdict, Silent(5999.0), Forecast, Allowance, 90_000.0);
            HomeJudgement.Judge(verdict, Silent(5999.0), Forecast, Allowance, 90_001.0);
            Assert.Equal(2, verdict.LostSeq);
        }

        [Fact]
        public void HomeWithNoForecastNeverDeclares()
        {
            var verdict = new HomeVerdict { Id = Craft };
            HomeJudgement.Judge(verdict, Silent(), null, Allowance, 90_000.0);
            HomeJudgement.Judge(verdict, Silent(), null, Allowance, 90_001.0);

            Assert.Equal(HomeVerdictState.Silent, verdict.State);
        }

        /// <summary>A crewed centre that heard the craft after the ground lost it puts the deadline back by as long.</summary>
        [Fact]
        public void ContactHeardAfterTheGroundLostTheCraftRunsTheForecastAgainFromIt()
        {
            Assert.Equal(4600.0, HomeJudgement.Wait(Silent(999.0), Forecast, Allowance));
            Assert.Equal(6600.0, HomeJudgement.Wait(Silent(3000.0), Forecast, Allowance));
        }

        [Fact]
        public void ACraftKnownGoneIsGoneAndNotDeclaredLost()
        {
            var verdict = Judged(4600.0);
            HomeJudgement.Judge(verdict, new CentreContact(CentreContactState.Gone, 999.0), Forecast, Allowance, 4601.0);
            HomeJudgement.Judge(verdict, Silent(), Forecast, Allowance, 4602.0);

            Assert.Equal(HomeVerdictState.Gone, verdict.State);
            Assert.Equal(0, verdict.LostSeq);
        }
    }
}
