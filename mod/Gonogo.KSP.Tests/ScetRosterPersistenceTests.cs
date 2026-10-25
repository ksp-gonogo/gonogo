using System.Collections.Generic;
using System.Linq;
using Gonogo.KSP;
using Sitrep.Contract;
using Xunit;

namespace Gonogo.KSP.Tests
{
    /// <summary>The save round-trip of the alarm roster. ConfigNode is a plain data structure, so it runs headlessly against the reference DLL.</summary>
    public class ScetRosterPersistenceTests
    {
        private static ScetAlarm Threshold() => new ScetAlarm
        {
            Id = "t",
            Name = "Apo",
            ArmedBy = "ground:Kerbal Space Center",
            Vantage = "vessel:abc",
            Subject = "vessel:abc",
            ActsOn = "vessel:abc",
            State = ScetAlarmState.Armed,
            GameEdits = 2,
            Condition = new ScetAlarmCondition
            {
                Kind = ScetAlarmConditionKind.Threshold,
                Topic = "vessel.flight",
                FieldPath = "altitudeAsl",
                Op = ScetAlarmThresholdOp.LessThan,
                Threshold = 70000.125,
                SustainSeconds = 3,
            },
            OnFire = new List<ScetAlarmAction> { new ScetAlarmAction { Kind = ScetAlarmActionKind.ActionGroup, Group = 3 } },
        };

        [Fact]
        public void AnArmedAlarmSurvivesTheRoundTripWithEveryField()
        {
            var time = new ScetAlarm
            {
                Id = "a",
                Name = "Burn",
                State = ScetAlarmState.Armed,
                GameAlarmId = 1584055298,
                Condition = new ScetAlarmCondition { Kind = ScetAlarmConditionKind.Time, Ut = 38256.47, LeadSeconds = 10 },
            };
            var node = new ConfigNode();
            ScetRosterPersistence.Save(new[] { time, Threshold() }, node);

            var restored = ScetRosterPersistence.Load(node);

            Assert.Equal(2, restored.Count);
            var a = restored.Single(r => r.Id == "a");
            Assert.Equal("Burn", a.Name);
            Assert.Equal(1584055298, a.GameAlarmId);
            Assert.Equal(38256.47, a.Condition!.Ut);
            Assert.Equal(10, a.Condition.LeadSeconds);
            var t = restored.Single(r => r.Id == "t");
            Assert.Equal("ground:Kerbal Space Center", t.ArmedBy);
            Assert.Equal("vessel:abc", t.ActsOn);
            Assert.Equal(2, t.GameEdits);
            Assert.Equal(ScetAlarmThresholdOp.LessThan, t.Condition!.Op);
            Assert.Equal(70000.125, t.Condition.Threshold);
            Assert.Equal("altitudeAsl", t.Condition.FieldPath);
            Assert.Equal(3, t.OnFire.Single().Group);
        }

        [Fact]
        public void OnlyArmedAlarmsAreWritten()
        {
            var fired = Threshold();
            fired.State = ScetAlarmState.Fired;
            var node = new ConfigNode();

            ScetRosterPersistence.Save(new[] { fired }, node);

            Assert.Empty(ScetRosterPersistence.Load(node));
        }

        [Fact]
        public void ASaveFromBeforeTheRosterWasSavedLoadsEmpty()
        {
            Assert.Empty(ScetRosterPersistence.Load(new ConfigNode()));
        }

        [Fact]
        public void ARowThatWillNotParseIsSkippedRatherThanThrowing()
        {
            var node = new ConfigNode();
            ScetRosterPersistence.Save(new[] { Threshold() }, node);
            var bad = node.GetNode("SCET_ALARMS").AddNode("ALARM");
            bad.AddValue("id", "bad");
            bad.AddNode("CONDITION").AddValue("kind", "not-a-number");

            var restored = ScetRosterPersistence.Load(node);

            Assert.Equal("t", Assert.Single(restored).Id);
        }
    }
}
