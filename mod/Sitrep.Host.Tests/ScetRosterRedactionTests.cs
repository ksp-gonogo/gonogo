using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Host.Alarms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Who is kept from what an alarm watches: a session at another command
    /// centre, never one outside the comparison.
    /// </summary>
    public class ScetRosterRedactionTests
    {
        private const string Ksc = "ground:KSC";
        private const string Craft = "vessel:aaaa";

        private static ScetAlarm Threshold(string armedBy) => new ScetAlarm
        {
            Id = "a",
            Name = "secret",
            ArmedBy = armedBy,
            Condition = new ScetAlarmCondition { Kind = ScetAlarmConditionKind.Threshold, Topic = "vessel.flight" },
        };

        [Fact]
        public void ASessionAtAnotherCentreIsWithheld()
        {
            Assert.True(ScetRosterRedaction.IsWithheldFrom(Threshold(Ksc), Craft));
        }

        [Fact]
        public void ASessionAtTheArmingCentreSeesTheCondition()
        {
            Assert.False(ScetRosterRedaction.IsWithheldFrom(Threshold(Ksc), Ksc));
        }

        [Fact]
        public void ATimeAlarmIsNeverWithheld()
        {
            var time = Threshold(Ksc);
            time.Condition = new ScetAlarmCondition { Kind = ScetAlarmConditionKind.Time };

            Assert.False(ScetRosterRedaction.IsWithheldFrom(time, Craft));
        }

        [Theory]
        [InlineData("")]
        [InlineData(null)]
        public void ASessionAtNoCentreSeesEverything(string? vantage)
        {
            Assert.False(ScetRosterRedaction.IsWithheldFrom(Threshold(Ksc), vantage));
        }

        [Fact]
        public void AnAlarmWithNoKnownArmingCentreIsShownToEveryone()
        {
            Assert.False(ScetRosterRedaction.IsWithheldFrom(Threshold(""), Craft));
        }

        [Fact]
        public void TheRosterForAMetaSessionKeepsEveryCondition()
        {
            var rows = (IEnumerable<ScetAlarm>)ScetRosterRedaction.ForViewer(
                new List<ScetAlarm> { Threshold(Ksc) },
                new ViewerContext("", "session"));

            var row = Assert.Single(rows);
            Assert.False(row.Withheld);
            Assert.NotNull(row.Condition);
        }
    }
}
