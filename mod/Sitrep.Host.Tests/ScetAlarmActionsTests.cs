using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Contract.Serialization;
using Sitrep.Host.Alarms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// A SCET alarm's onboard actions: which arms may carry them, that they are
    /// queued by the fire that owes them and nothing else, and that running them
    /// reaches the craft through the same handlers its own commands use.
    /// </summary>
    public class ScetAlarmActionsTests
    {
        private const string Craft = "vessel:abc";

        private sealed class FakeReader : IScetStateReader
        {
            public ScetReading Next = ScetReading.NotObservable;

            public IDictionary<string, object?>? ReadPayload(string subject, string topic) => null;

            public ScetReading Read(string subject, string topic, string fieldPath) => Next;
        }

        private static ScetAlarmArmArgs Threshold(
            string id = "a1", string subject = Craft, string vantage = "", string topic = "vessel.flight") =>
            new ScetAlarmArmArgs
            {
                Id = id,
                Name = "Stage at 100 km",
                Subject = subject,
                Vantage = vantage,
                Condition = new ScetAlarmCondition
                {
                    Kind = ScetAlarmConditionKind.Threshold,
                    Topic = topic,
                    FieldPath = "altitudeAsl",
                    Op = ScetAlarmThresholdOp.GreaterThan,
                    Threshold = 100_000,
                },
            };

        private static ScetAlarmArmArgs Time(string id = "t1", double ut = 1_000, string actsOn = Craft) =>
            new ScetAlarmArmArgs
            {
                Id = id,
                Name = "Burn",
                Subject = "game",
                ActsOn = actsOn,
                Condition = new ScetAlarmCondition { Kind = ScetAlarmConditionKind.Time, Ut = ut },
            };

        private static List<ScetAlarmAction> Stage() =>
            new List<ScetAlarmAction> { new ScetAlarmAction { Kind = ScetAlarmActionKind.Stage } };

        private static ScetAlarmArmArgs With(ScetAlarmArmArgs args, params ScetAlarmAction[] actions)
        {
            args.OnFire = actions.ToList();
            return args;
        }

        [Fact]
        public void AThresholdOnTheCraftReadAboardMayCarryActions()
        {
            Assert.Null(ScetAlarmActions.RefusalFor(With(Threshold(), Stage().ToArray())));
        }

        [Fact]
        public void ATimeOnTheGameClockMayCarryActionsForANamedCraft()
        {
            Assert.Null(ScetAlarmActions.RefusalFor(With(Time(), Stage().ToArray())));
        }

        [Fact]
        public void AnAlarmReadAtACommandCentreMayNotCarryActions()
        {
            var args = With(Threshold(vantage: "ground:Kerbal Space Center"), Stage().ToArray());
            Assert.Contains("aboard the craft", ScetAlarmActions.RefusalFor(args));
        }

        [Fact]
        public void AThresholdOnTheGamesOwnStateMayNotCarryActions()
        {
            var args = With(Threshold(subject: "game", topic: "career.status"), Stage().ToArray());
            Assert.Contains("not aboard any craft", ScetAlarmActions.RefusalFor(args));
        }

        [Fact]
        public void ATimedActionMustNameItsCraft()
        {
            var args = With(Time(actsOn: ""), Stage().ToArray());
            Assert.Contains("the craft it acts on", ScetAlarmActions.RefusalFor(args));
        }

        [Fact]
        public void AThresholdActsOnTheCraftItReadsAndNoOther()
        {
            var args = With(Threshold(), Stage().ToArray());
            args.ActsOn = "vessel:other";
            Assert.Contains("the craft its alarm reads", ScetAlarmActions.RefusalFor(args));

            args.ActsOn = "";
            Assert.Null(ScetAlarmActions.RefusalFor(args));
            Assert.Equal(Craft, ScetAlarmActions.ActsOnOf(args));
        }

        [Fact]
        public void ACustomGroupIsNumberedFromOne()
        {
            var args = With(Threshold(), new ScetAlarmAction { Kind = ScetAlarmActionKind.ActionGroup, Group = 0 });
            Assert.Contains("numbered from 1", ScetAlarmActions.RefusalFor(args));
        }

        [Fact]
        public void AnAlarmWithNoActionsIsNeverRefusedForThem()
        {
            Assert.Null(ScetAlarmActions.RefusalFor(Threshold(vantage: "ground:Kerbal Space Center")));
        }

        [Fact]
        public void AFireQueuesItsActionsBesideItsNotice()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(With(Threshold(), Stage().ToArray()), "ground:Kerbal Space Center");

            var tick = roster.Evaluate(10, new FakeReader { Next = ScetReading.Observed(101_000) });

            var due = Assert.Single(tick.ActionsDue);
            Assert.Same(Assert.Single(tick.Fired), due.Notice);
            Assert.Equal(Craft, due.ActsOn);
            Assert.Equal(ScetAlarmActionKind.Stage, Assert.Single(due.Actions).Kind);
        }

        [Fact]
        public void AFireQueuesNothingOnTheTicksAfterIt()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(With(Threshold(), Stage().ToArray()), "");
            var reader = new FakeReader { Next = ScetReading.Observed(101_000) };

            roster.Evaluate(10, reader);
            var after = roster.Evaluate(11, reader);

            Assert.Empty(after.ActionsDue);
        }

        /// <summary>
        /// The roster holds the line itself for an entry the arm would have
        /// refused, so a verdict judged against a command centre can never act on
        /// the craft whatever route put it there.
        /// </summary>
        [Fact]
        public void AFireReadAtACommandCentreQueuesNoActions()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(With(Threshold(vantage: "ground:Kerbal Space Center"), Stage().ToArray()), "");

            var tick = roster.Evaluate(10, new FakeReader { Next = ScetReading.Observed(101_000) });

            Assert.Single(tick.Fired);
            Assert.Empty(tick.ActionsDue);
        }

        [Fact]
        public void TheRosterCarriesTheActionsAndACraftForThem()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(With(Threshold(), new ScetAlarmAction { Kind = ScetAlarmActionKind.ActionGroup, Group = 7 }), "");

            var row = Assert.Single(roster.Snapshot());

            var action = Assert.Single(row.OnFire);
            Assert.Equal(ScetAlarmActionKind.ActionGroup, action.Kind);
            Assert.Equal(7, action.Group);
            Assert.Equal(Craft, row.ActsOn);
        }

        [Fact]
        public void ChangingOnlyTheActionsIsAChange()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(With(Threshold(), Stage().ToArray()), "");

            var changed = roster.Arm(
                With(Threshold(), new ScetAlarmAction { Kind = ScetAlarmActionKind.ActionGroup, Group = 3 }), "");

            Assert.True(changed);
            Assert.Equal(ScetAlarmActionKind.ActionGroup, Assert.Single(Assert.Single(roster.Snapshot()).OnFire).Kind);
        }

        [Fact]
        public void TheActionsRunOnTheCraftTheyAreFor()
        {
            var actuator = new FakeVesselActuator();
            var due = new ScetAlarmActionsDue(new ScetAlarmFired { Id = "a1" }, Craft, new[]
            {
                new ScetAlarmAction { Kind = ScetAlarmActionKind.ActionGroup, Group = 7 },
                new ScetAlarmAction { Kind = ScetAlarmActionKind.Stage },
                new ScetAlarmAction { Kind = ScetAlarmActionKind.Sas },
            });

            var results = ScetAlarmActions.Run(due, Craft, actuator, a => a.Kind == ScetAlarmActionKind.Sas);

            Assert.All(results, r => Assert.True(r.Success));
            Assert.Equal(7, actuator.LastActionGroup);
            Assert.True(actuator.LastActionGroupState);
            Assert.Equal(1, actuator.StageCallCount);
            Assert.False(actuator.LastSetSasEnabled);
            Assert.False(due.Notice.ActionsWithheld);
        }

        [Fact]
        public void TheActionsAreWithheldFromAnyOtherCraftAndTheNoticeSaysSo()
        {
            var actuator = new FakeVesselActuator();
            var due = new ScetAlarmActionsDue(new ScetAlarmFired { Id = "t1" }, Craft, Stage());

            var results = ScetAlarmActions.Run(due, "vessel:someone-else", actuator, _ => false);

            Assert.Empty(results);
            Assert.Equal(0, actuator.StageCallCount);
            Assert.True(due.Notice.ActionsWithheld);
        }

        [Fact]
        public void TheActionsAreWithheldWhenNothingIsBeingFlown()
        {
            var due = new ScetAlarmActionsDue(new ScetAlarmFired { Id = "t1" }, Craft, Stage());

            ScetAlarmActions.Run(due, null, new FakeVesselActuator(), _ => false);

            Assert.True(due.Notice.ActionsWithheld);
        }

        [Fact]
        public void AToggleWhoseStateIsUnknownIsRefusedRatherThanGuessed()
        {
            var actuator = new FakeVesselActuator();

            var result = ScetAlarmActions.RunOne(
                new ScetAlarmAction { Kind = ScetAlarmActionKind.Gear }, actuator, _ => null);

            Assert.False(result.Success);
            Assert.Equal(CommandErrorCode.NotClearToProceed, result.ErrorCode);
            Assert.Null(actuator.LastSetGearEnabled);
        }

        /// <summary>
        /// Both payloads are written by hand rather than by reflection, so the
        /// field names the client reads are pinned here against the ones the
        /// generated contract declares.
        /// </summary>
        [Fact]
        public void TheRosterAndTheNoticeCarryTheActionsOnTheWire()
        {
            var row = Wire("alarm.scet", new List<ScetAlarm> { new ScetAlarm
            {
                Id = "a1",
                OnFire = new List<ScetAlarmAction>
                {
                    new ScetAlarmAction { Kind = ScetAlarmActionKind.Stage },
                    new ScetAlarmAction { Kind = ScetAlarmActionKind.ActionGroup, Group = 7 },
                },
                ActsOn = Craft,
            } });
            var notice = Wire("alarm.scet.fired", new ScetAlarmFired { Id = "a1", ActionsWithheld = true });

            Assert.Contains(
                "\"onFire\":[{\"kind\":1,\"group\":0},{\"kind\":0,\"group\":7}],\"actsOn\":\"vessel:abc\"",
                row);
            Assert.Contains("\"actionsWithheld\":true", notice);
        }

        private static string Wire(string topic, object payload) =>
            EnvelopeCodec.WriteStreamData(new StreamData<object?> { Topic = topic, Payload = payload });

        [Theory]
        [InlineData(ScetAlarmActionKind.Rcs)]
        [InlineData(ScetAlarmActionKind.Lights)]
        [InlineData(ScetAlarmActionKind.Gear)]
        [InlineData(ScetAlarmActionKind.Brakes)]
        [InlineData(ScetAlarmActionKind.Abort)]
        public void EachStockToggleFlipsItsOwnSwitch(ScetAlarmActionKind kind)
        {
            var actuator = new FakeVesselActuator();

            var result = ScetAlarmActions.RunOne(new ScetAlarmAction { Kind = kind }, actuator, _ => true);

            Assert.True(result.Success);
            var flipped = kind switch
            {
                ScetAlarmActionKind.Rcs => actuator.LastSetRcsEnabled,
                ScetAlarmActionKind.Lights => actuator.LastSetLightsEnabled,
                ScetAlarmActionKind.Gear => actuator.LastSetGearEnabled,
                ScetAlarmActionKind.Brakes => actuator.LastSetBrakesEnabled,
                _ => actuator.LastSetAbortEnabled,
            };
            Assert.False(flipped);
            Assert.Null(actuator.LastActionGroup);
            Assert.Equal(0, actuator.StageCallCount);
        }
    }
}
