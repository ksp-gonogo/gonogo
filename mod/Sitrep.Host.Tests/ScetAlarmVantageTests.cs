using Sitrep.Contract;
using Sitrep.Host.Alarms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Where an alarm reads, and whether that is the subject's own state.
    /// </summary>
    public class ScetAlarmVantageTests
    {
        private static ScetAlarm Alarm(string subject, string vantage) =>
            new ScetAlarm { Id = "a", Subject = subject, Vantage = vantage };

        [Fact]
        public void AnAlarmNamingNoVantageReadsAtItsOwnSubject()
        {
            var alarm = Alarm("vessel:abc", "");

            Assert.Equal("vessel:abc", ScetAlarmVantage.Of(alarm));
            Assert.True(ScetAlarmVantage.IsTheSubjectsOwn(alarm));
        }

        /// <summary>
        /// The whole population that predates command-centre vantages: an alarm
        /// spelling out its own craft means the same as one naming nothing, so
        /// nothing about which reader it gets turns on which way a client wrote
        /// it down.
        /// </summary>
        [Fact]
        public void NamingItsOwnSubjectIsTheSameAsNamingNothing()
        {
            Assert.True(ScetAlarmVantage.IsTheSubjectsOwn(Alarm("vessel:abc", "vessel:abc")));
        }

        [Fact]
        public void AnAlarmAtACommandCentreReadsThere()
        {
            var alarm = Alarm("vessel:abc", "ground:Kerbal Space Center");

            Assert.Equal("ground:Kerbal Space Center", ScetAlarmVantage.Of(alarm));
            Assert.False(ScetAlarmVantage.IsTheSubjectsOwn(alarm));
        }

        /// <summary>
        /// A career threshold's subject is the save rather than anything flying,
        /// and an alarm on it naming no vantage reads the simulation's own
        /// books, which is what "at the game" meant all along.
        /// </summary>
        [Fact]
        public void AGameSubjectedAlarmReadsTheSimulationsOwnState()
        {
            Assert.True(ScetAlarmVantage.IsTheSubjectsOwn(Alarm("game", "")));
            Assert.False(ScetAlarmVantage.IsTheSubjectsOwn(Alarm("game", "ground:Kerbal Space Center")));
        }

        /// <summary>
        /// An alarm at its own subject asks the ledger nothing, so there is no
        /// place to get wrong and nothing to check it against. This is the whole
        /// population that predates command-centre vantages, and an arm naming no
        /// vantage resolves to it, so the check only ever bites an arm that named
        /// a place of its own.
        /// </summary>
        [Theory]
        [InlineData(true)]
        [InlineData(false)]
        [InlineData(null)]
        public void ItsOwnSubjectIsArmableWhateverTheSimulationKnowsAboutPlaces(bool? selectable)
        {
            Assert.Equal(
                ScetVantageVerdict.Armable,
                ScetAlarmVantage.VerdictFor("vessel:abc", "vessel:abc", selectable));
        }

        [Fact]
        public void AnActiveCommandCentreIsArmable()
        {
            Assert.Equal(
                ScetVantageVerdict.Armable,
                ScetAlarmVantage.VerdictFor("ground:Kerbal Space Center", "vessel:abc", true));
        }

        /// <summary>
        /// The defect this check exists for: a vantage nothing corresponds to
        /// reads nothing and never comes due, which an operator cannot tell apart
        /// from a condition that has not been met.
        /// </summary>
        [Fact]
        public void APlaceTheSimulationDoesNotKnowIsRefused()
        {
            Assert.Equal(
                ScetVantageVerdict.NoSuchPlace,
                ScetAlarmVantage.VerdictFor("ground:Nowhere", "vessel:abc", false));
        }

        /// <summary>
        /// Refused too, and this is the case worth the second verdict. Accepting
        /// would arm an alarm that reads nothing and that nothing re-checks, which
        /// is the silent failure the whole check removes. Refusing it as "no such
        /// place" would state something the simulation has not established, since
        /// the set is empty at the main menu and before the first capture.
        /// </summary>
        [Fact]
        public void APlaceNamedBeforeAnyIsKnownIsRefusedAsItsOwnVerdict()
        {
            Assert.Equal(
                ScetVantageVerdict.NoPlacesKnown,
                ScetAlarmVantage.VerdictFor("ground:Kerbal Space Center", "vessel:abc", null));
        }

        /// <summary>
        /// A time alarm names no craft, so its subject is the game and an arm
        /// naming no vantage is armable with nothing loaded at all. That is the
        /// case that makes the empty set reachable rather than theoretical.
        /// </summary>
        [Fact]
        public void ATimeAlarmIsArmableWithNothingLoaded()
        {
            Assert.Equal(
                ScetVantageVerdict.Armable,
                ScetAlarmVantage.VerdictFor("game", "game", null));
        }
    }
}
