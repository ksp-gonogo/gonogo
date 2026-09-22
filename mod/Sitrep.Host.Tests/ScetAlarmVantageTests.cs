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
    }
}
