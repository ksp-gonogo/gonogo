using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Host.Alarms;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// The game's alarm clock beside Gonogo's own alarms, headlessly: which game
    /// alarms are a reading of a craft, which Gonogo alarms are copied into the
    /// game, and what a delete on either side does to the other.
    /// </summary>
    public class GameAlarmTests
    {
        private const string Craft = "4f1c2b9e-0000-0000-0000-000000000001";

        private sealed class FakeClock : IGameAlarmClock
        {
            public string ProviderId => "fake";

            public bool Available { get; set; } = true;

            public readonly Dictionary<long, GameAlarmRecord> Held = new Dictionary<long, GameAlarmRecord>();

            public readonly List<long> Deleted = new List<long>();

            private long _next = 100;

            public IReadOnlyList<GameAlarmRecord> Alarms() =>
                Available ? Held.Values.ToList() : new List<GameAlarmRecord>();

            public long? CreateAtUt(string title, double ut)
            {
                if (!Available)
                {
                    return null;
                }
                var id = _next++;
                Held[id] = new GameAlarmRecord { Id = id, Kind = GameAlarmKind.Time, Title = title, Ut = ut, Warp = GameAlarmWarp.Nothing };
                return id;
            }

            public bool Delete(long id)
            {
                Deleted.Add(id);
                return Held.Remove(id);
            }

            /// <summary>The player deleting an alarm in the game's own window.</summary>
            public void PlayerDeletes(long id) => Held.Remove(id);
        }

        private static ScetAlarmArmArgs TimeAlarm(string id, double ut, string name = "Burn") => new ScetAlarmArmArgs
        {
            Id = id,
            Name = name,
            Condition = new ScetAlarmCondition { Kind = ScetAlarmConditionKind.Time, Ut = ut, LeadSeconds = 10 },
        };

        private static ScetAlarmArmArgs Threshold(string id, string vantage) => new ScetAlarmArmArgs
        {
            Id = id,
            Name = "Apo",
            Subject = "vessel:" + Craft,
            Vantage = vantage,
            Condition = new ScetAlarmCondition
            {
                Kind = ScetAlarmConditionKind.Threshold,
                Topic = "vessel.flight",
                FieldPath = "altitudeAsl",
                Threshold = 70000,
            },
        };

        private static (ScetAlarmRoster Roster, GameAlarmMirror Mirror, FakeClock Clock, Dictionary<string, long> Links) World()
        {
            var links = new Dictionary<string, long>();
            return (new ScetAlarmRoster(), new GameAlarmMirror(links), new FakeClock(), links);
        }

        private static GameAlarmMirrorOutcome Sync(ScetAlarmRoster roster, GameAlarmMirror mirror, IGameAlarmClock? clock, double ut)
        {
            var outcome = mirror.Reconcile(roster.Snapshot(), clock, ut);
            foreach (var link in outcome.Links)
            {
                roster.SetGameAlarm(link.Key, link.Value);
            }
            foreach (var id in outcome.DeletedInGame)
            {
                roster.MarkDeletedInGame(id);
            }
            return outcome;
        }

        [Fact]
        public void a_gonogo_alarm_on_a_universal_time_is_copied_into_the_game_clock()
        {
            var (roster, mirror, clock, _) = World();
            roster.Arm(TimeAlarm("a", 5000), "KSC");

            Sync(roster, mirror, clock, 100);

            var copy = Assert.Single(clock.Held.Values);
            Assert.Equal(5000, copy.Ut);
            Assert.Equal("Burn", copy.Title);
            Assert.Equal(copy.Id, roster.Snapshot().Single().GameAlarmId);
        }

        [Fact]
        public void a_rearm_with_the_same_time_keeps_its_copy_and_a_moved_time_moves_it()
        {
            var (roster, mirror, clock, _) = World();
            roster.Arm(TimeAlarm("a", 5000), "KSC");
            Sync(roster, mirror, clock, 100);
            var first = clock.Held.Keys.Single();

            roster.Arm(TimeAlarm("a", 5000), "KSC");
            Sync(roster, mirror, clock, 101);
            Assert.Equal(first, clock.Held.Keys.Single());

            roster.Arm(TimeAlarm("a", 6000), "KSC");
            Sync(roster, mirror, clock, 102);
            var moved = Assert.Single(clock.Held.Values);
            Assert.Equal(6000, moved.Ut);
            Assert.Equal(moved.Id, roster.Snapshot().Single().GameAlarmId);
        }

        [Theory]
        [InlineData("command")]
        [InlineData("scet")]
        public void a_threshold_alarm_never_goes_to_the_game_at_either_vantage(string vantage)
        {
            var (roster, mirror, clock, _) = World();
            roster.Arm(Threshold("t", vantage == "scet" ? "vessel:" + Craft : "KSC"), "KSC");

            Sync(roster, mirror, clock, 100);

            Assert.Empty(clock.Held);
            Assert.Null(roster.Snapshot().Single().GameAlarmId);
        }

        [Fact]
        public void an_alarm_that_follows_a_topic_or_a_contract_never_goes_to_the_game()
        {
            var (roster, mirror, clock, _) = World();
            roster.Arm(new ScetAlarmArmArgs
            {
                Id = "i",
                Condition = new ScetAlarmCondition { Kind = ScetAlarmConditionKind.TopicInstant, Topic = "vessel.orbit", FieldPath = "encounter.transitionUt", Ut = 5000 },
            }, "KSC");
            roster.Arm(new ScetAlarmArmArgs
            {
                Id = "c",
                Condition = new ScetAlarmCondition { Kind = ScetAlarmConditionKind.ContractParameter, ContractId = "x", ParameterTitle = "Orbit" },
            }, "KSC");

            Sync(roster, mirror, clock, 100);

            Assert.Empty(clock.Held);
        }

        [Fact]
        public void disarming_in_gonogo_deletes_the_copy_in_the_game()
        {
            var (roster, mirror, clock, links) = World();
            roster.Arm(TimeAlarm("a", 5000), "KSC");
            Sync(roster, mirror, clock, 100);

            roster.Disarm("a");
            mirror.Disarmed("a");
            Sync(roster, mirror, clock, 101);

            Assert.Empty(clock.Held);
            Assert.Empty(links);
        }

        [Fact]
        public void a_cancelled_or_fired_alarm_takes_its_copy_with_it()
        {
            var (roster, mirror, clock, _) = World();
            roster.Arm(TimeAlarm("a", 5000), "KSC");
            roster.ObserveFlownCraft("vessel:one");
            Sync(roster, mirror, clock, 100);
            Assert.Single(clock.Held);

            roster.ObserveFlownCraft("vessel:two");
            Sync(roster, mirror, clock, 101);
            Assert.Empty(clock.Held);

            roster.Arm(TimeAlarm("b", 200), "KSC");
            Sync(roster, mirror, clock, 102);
            Assert.Single(clock.Held);
            roster.Evaluate(200);
            Assert.Equal(ScetAlarmState.Fired, roster.Snapshot().Single(a => a.Id == "b").State);
            Sync(roster, mirror, clock, 200);
            Assert.Empty(clock.Held);
        }

        [Fact]
        public void deleting_the_copy_in_the_game_deletes_the_gonogo_alarm_and_refuses_it_again()
        {
            var (roster, mirror, clock, _) = World();
            roster.Arm(TimeAlarm("a", 5000), "KSC");
            Sync(roster, mirror, clock, 100);

            clock.PlayerDeletes(clock.Held.Keys.Single());
            var outcome = Sync(roster, mirror, clock, 101);

            Assert.Equal(new[] { "a" }, outcome.DeletedInGame);
            var row = roster.Snapshot().Single();
            Assert.Equal(ScetAlarmState.DeletedInGame, row.State);
            Assert.Null(row.GameAlarmId);
            Assert.True(roster.IsDeletedInGame("a"));

            Sync(roster, mirror, clock, 102);
            Assert.Empty(clock.Held);
        }

        [Fact]
        public void a_copy_the_game_removed_when_it_came_due_is_not_a_delete()
        {
            var (roster, mirror, clock, _) = World();
            roster.Arm(TimeAlarm("a", 5000), "KSC");
            Sync(roster, mirror, clock, 100);

            clock.PlayerDeletes(clock.Held.Keys.Single());
            var outcome = Sync(roster, mirror, clock, 5000);

            Assert.Empty(outcome.DeletedInGame);
            Assert.False(roster.IsDeletedInGame("a"));
        }

        [Fact]
        public void with_no_game_clock_nothing_is_copied_until_one_appears()
        {
            var (roster, mirror, clock, _) = World();
            clock.Available = false;
            roster.Arm(TimeAlarm("a", 5000), "KSC");

            Sync(roster, mirror, null, 100);
            Sync(roster, mirror, clock, 101);
            Assert.Empty(clock.Held);
            Assert.Null(roster.Snapshot().Single().GameAlarmId);

            clock.Available = true;
            Sync(roster, mirror, clock, 102);
            Assert.Single(clock.Held);
        }

        [Fact]
        public void a_rearm_after_a_quickload_adopts_the_copy_the_save_restored()
        {
            var (roster, mirror, clock, links) = World();
            clock.Held[7] = new GameAlarmRecord { Id = 7, Kind = GameAlarmKind.Time, Title = "Burn", Ut = 5000 };
            links["a"] = 7;

            roster.Arm(TimeAlarm("a", 5000), "KSC");
            Sync(roster, mirror, clock, 100);

            Assert.Equal(new long[] { 7 }, clock.Held.Keys.ToArray());
            Assert.Empty(clock.Deleted);
            Assert.Equal(7, roster.Snapshot().Single().GameAlarmId);
        }

        [Fact]
        public void a_copy_whose_gonogo_alarm_is_not_armed_again_is_left_in_the_game()
        {
            var (roster, mirror, clock, links) = World();
            clock.Held[7] = new GameAlarmRecord { Id = 7, Kind = GameAlarmKind.Time, Title = "Burn", Ut = 5000 };
            links["a"] = 7;

            Sync(roster, mirror, clock, 100);

            Assert.Single(clock.Held);
        }

        [Fact]
        public void a_rearm_keeps_the_link_to_the_copy_on_the_roster()
        {
            var roster = new ScetAlarmRoster();
            roster.Arm(TimeAlarm("a", 5000), "KSC");
            roster.SetGameAlarm("a", 9);

            roster.Arm(TimeAlarm("a", 6000), "KSC");

            Assert.Equal(9, roster.Snapshot().Single().GameAlarmId);
        }

        [Fact]
        public void deleting_a_copy_from_gonogo_names_the_gonogo_alarm_it_was_for()
        {
            var (roster, mirror, clock, _) = World();
            roster.Arm(TimeAlarm("a", 5000), "KSC");
            Sync(roster, mirror, clock, 100);
            var copy = clock.Held.Keys.Single();

            Assert.Equal("a", mirror.ForgetGameAlarm(copy));
            Assert.Null(mirror.ForgetGameAlarm(12345));
        }

        private static GameAlarmRecord Record(long id, GameAlarmKind kind, string? vessel) =>
            new GameAlarmRecord { Id = id, Kind = kind, Title = kind.ToString(), Ut = 1000 + id, Vessel = vessel };

        [Theory]
        [InlineData(GameAlarmKind.Time, false)]
        [InlineData(GameAlarmKind.TransferWindow, false)]
        [InlineData(GameAlarmKind.SoiChange, true)]
        [InlineData(GameAlarmKind.Apoapsis, true)]
        [InlineData(GameAlarmKind.Periapsis, true)]
        [InlineData(GameAlarmKind.Maneuver, true)]
        [InlineData(GameAlarmKind.Other, true)]
        public void an_alarm_is_a_reading_of_its_craft_by_how_its_time_is_worked_out(GameAlarmKind kind, bool craftDerived)
        {
            Assert.Equal(craftDerived, GameAlarmBoard.IsCraftDerived(Record(1, kind, Craft)));
        }

        [Fact]
        public void a_players_own_time_labelled_with_a_craft_is_on_the_shared_list()
        {
            var view = GameAlarmBoard.Build(true, new[] { Record(1, GameAlarmKind.Time, Craft) }, null);

            var row = Assert.Single(view.Plan);
            Assert.Equal("vessel:" + Craft, row.Vessel);
            Assert.Empty(view.ByCraft);
        }

        [Fact]
        public void craft_derived_alarms_go_only_on_their_crafts_topic()
        {
            var view = GameAlarmBoard.Build(true, new[]
            {
                Record(1, GameAlarmKind.SoiChange, Craft),
                Record(2, GameAlarmKind.Maneuver, Craft),
                Record(3, GameAlarmKind.TransferWindow, null),
                Record(4, GameAlarmKind.Apoapsis, null),
                Record(5, GameAlarmKind.Other, null),
            }, null);

            Assert.Equal(new long[] { 3, 5 }, view.Plan.Select(a => a.Id).ToArray());
            Assert.Equal(new long[] { 1, 2 }, view.ByCraft[Craft].Select(a => a.Id).ToArray());
        }

        [Fact]
        public void a_copy_is_marked_with_the_gonogo_alarm_it_was_made_for()
        {
            var view = GameAlarmBoard.Build(
                true,
                new[] { Record(7, GameAlarmKind.Time, null) },
                new Dictionary<long, string> { [7] = "a" });

            Assert.Equal("a", view.Plan.Single().GonogoId);
        }

        [Fact]
        public void with_no_clock_the_list_says_so_and_holds_nothing()
        {
            var view = GameAlarmBoard.Build(false, new[] { Record(1, GameAlarmKind.Time, null) }, null);

            Assert.False(view.Available);
            Assert.Empty(view.Plan);
            Assert.Empty(view.ByCraft);
        }

        [Fact]
        public void the_wire_carries_every_field()
        {
            var wire = GameAlarmBoard.ToWire(new GameAlarm
            {
                Id = 3,
                Kind = GameAlarmKind.Periapsis,
                Title = "Pe",
                Ut = 12.5,
                Vessel = "vessel:" + Craft,
                Warp = GameAlarmWarp.Pause,
                Triggered = true,
                GonogoId = "g",
            });

            Assert.Equal(3L, wire["id"]);
            Assert.Equal((int)GameAlarmKind.Periapsis, wire["kind"]);
            Assert.Equal("Pe", wire["title"]);
            Assert.Equal(12.5, wire["ut"]);
            Assert.Equal("vessel:" + Craft, wire["vessel"]);
            Assert.Equal((int)GameAlarmWarp.Pause, wire["warp"]);
            Assert.Equal(true, wire["triggered"]);
            Assert.Equal("g", wire["gonogoId"]);
        }

        [Fact]
        public void a_craft_whose_last_alarm_went_is_told_with_an_empty_list()
        {
            var publication = new GameAlarmPublication();
            var withOne = GameAlarmBoard.Build(true, new[] { Record(1, GameAlarmKind.Apoapsis, Craft) }, null);
            var none = GameAlarmBoard.Build(true, new GameAlarmRecord[0], null);

            Assert.Single(publication.Next(withOne, true, _ => true).Crafts[Craft]);
            Assert.Empty(publication.Next(none, true, _ => true).Crafts[Craft]);
            Assert.False(publication.Next(none, true, _ => true).Crafts.ContainsKey(Craft));
        }

        [Fact]
        public void a_late_subscriber_to_a_craft_is_told_its_alarms()
        {
            var publication = new GameAlarmPublication();
            var view = GameAlarmBoard.Build(true, new[] { Record(1, GameAlarmKind.Apoapsis, Craft) }, null);

            Assert.False(publication.Next(view, false, _ => false).Crafts.ContainsKey(Craft));
            Assert.False(publication.Next(view, false, _ => false).Crafts.ContainsKey(Craft));
            Assert.Single(publication.Next(view, false, _ => true).Crafts[Craft]);
            Assert.False(publication.Next(view, false, _ => true).Crafts.ContainsKey(Craft));
        }
    }
}
