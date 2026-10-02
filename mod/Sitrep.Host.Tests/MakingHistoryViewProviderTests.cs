using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Sitrep.Host.Tests
{
    /// <summary>
    /// Headless test for the Making History uplink's
    /// <see cref="MakingHistoryViewProvider"/>. The fixtures are hand-written
    /// from the shape of the decompiled <c>Expansions.Missions</c> types
    /// (<c>Mission</c>, <c>MENode</c>); none of it was captured from a running
    /// Making History install, because the operator does not own the DLC.
    /// </summary>
    public class MakingHistoryViewProviderTests
    {
        [Fact]
        public void BuildMissionReturnsNullWhenSnapshotIsNull()
        {
            Assert.Null(MakingHistoryViewProvider.BuildMissionStatus(null));
        }

        [Fact]
        public void BuildMissionReturnsNullWhenThereIsNoMissionsGroup()
        {
            var snapshot = new KspSnapshot { Ut = 0.0, Values = new Dictionary<string, object?>() };

            Assert.Null(MakingHistoryViewProvider.BuildMissionStatus(snapshot));
        }

        [Fact]
        public void BuildMissionMapsTheRunningMission()
        {
            var root = Assert.IsType<Dictionary<string, object?>>(MakingHistoryViewProvider.BuildMissionStatus(Snapshot(RunningMission())));

            Assert.Equal("First Steps", root["name"]);
            Assert.Equal("Reach orbit", root["phase"]);
            Assert.Equal(true, root["started"]);
            Assert.Equal(false, root["finished"]);
            Assert.Equal(true, root["scoreEnabled"]);
            Assert.Equal(150.0, root["score"]);
            Assert.Equal(1000.0, root["maxScore"]);

            var objectives = Assert.IsType<List<object?>>(root["objectives"]);
            Assert.Equal(3, objectives.Count);
            var states = objectives.Select(o => ((Dictionary<string, object?>)o!)["state"]).ToArray();
            Assert.Equal(new object?[] { (int)MissionObjectiveState.Reached, (int)MissionObjectiveState.Active, (int)MissionObjectiveState.Pending }, states);
            Assert.Equal("Leave the pad", ((Dictionary<string, object?>)objectives[0]!)["title"]);
        }

        [Fact]
        public void BuildMissionKeepsAnEmptyObjectiveListEmptyNotNull()
        {
            var mission = RunningMission();
            mission["objectives"] = new List<object?>();

            var root = Assert.IsType<Dictionary<string, object?>>(MakingHistoryViewProvider.BuildMissionStatus(Snapshot(mission)));

            Assert.Empty(Assert.IsType<List<object?>>(root["objectives"]));
        }

        [Fact]
        public void BuildMissionCarriesAbsentFieldsAsNullNeverASentinel()
        {
            var mission = new Dictionary<string, object?> { ["name"] = "Bare" };

            var root = Assert.IsType<Dictionary<string, object?>>(MakingHistoryViewProvider.BuildMissionStatus(Snapshot(mission)));

            Assert.Null(root["phase"]);
            Assert.Null(root["finished"]);
            Assert.Null(root["score"]);
        }

        [Fact]
        public void ASuccessfulEndMarksTheActiveNodeReached()
        {
            var mission = RunningMission();
            mission["finished"] = true;
            mission["succeeded"] = true;

            Assert.Equal(
                new object?[] { (int)MissionObjectiveState.Reached, (int)MissionObjectiveState.Reached, (int)MissionObjectiveState.Pending },
                States(mission));
        }

        [Fact]
        public void AFailedEndMarksTheActiveAndUnreachedNodesFailed()
        {
            var mission = RunningMission();
            mission["finished"] = true;
            mission["succeeded"] = false;

            Assert.Equal(
                new object?[] { (int)MissionObjectiveState.Reached, (int)MissionObjectiveState.Failed, (int)MissionObjectiveState.Failed },
                States(mission));
        }

        [Theory]
        [InlineData(null, null, false, false, null)]
        [InlineData(false, false, false, false, MissionObjectiveState.Pending)]
        [InlineData(true, true, false, false, MissionObjectiveState.Active)]
        [InlineData(true, false, false, false, MissionObjectiveState.Reached)]
        [InlineData(false, false, true, true, MissionObjectiveState.Pending)]
        [InlineData(false, false, true, false, MissionObjectiveState.Failed)]
        [InlineData(true, false, true, false, MissionObjectiveState.Reached)]
        public void ObjectiveStateFollowsTheRule(bool? activated, bool? active, bool finished, bool succeeded, MissionObjectiveState? expected)
        {
            Assert.Equal(expected, MakingHistoryViewProvider.ObjectiveState(activated, active, finished, succeeded));
        }

        [Fact]
        public void AnUnreadMissionEndIsNotTreatedAsAFailure()
        {
            Assert.Equal(MissionObjectiveState.Pending, MakingHistoryViewProvider.ObjectiveState(false, false, null, null));
            Assert.Equal(MissionObjectiveState.Active, MakingHistoryViewProvider.ObjectiveState(true, true, null, null));
        }

        [Fact]
        public void MissionStatusTypeMirrorsProviderWireShape()
        {
            var root = Assert.IsType<Dictionary<string, object?>>(MakingHistoryViewProvider.BuildMissionStatus(Snapshot(RunningMission())));

            AssertEntryMirrors(typeof(MissionStatus), root);
            var entry = Assert.IsType<Dictionary<string, object?>>(Assert.IsType<List<object?>>(root["objectives"])[0]);
            AssertEntryMirrors(typeof(MissionObjectiveEntry), entry);
        }

        private static object?[] States(Dictionary<string, object?> mission)
        {
            var root = (Dictionary<string, object?>)MakingHistoryViewProvider.BuildMissionStatus(Snapshot(mission))!;
            return ((List<object?>)root["objectives"]!).Select(o => ((Dictionary<string, object?>)o!)["state"]).ToArray();
        }

        private static KspSnapshot Snapshot(Dictionary<string, object?> mission) => new KspSnapshot
        {
            Ut = 0.0,
            Values = new Dictionary<string, object?> { ["missions"] = mission },
        };

        private static Dictionary<string, object?> RunningMission() => new Dictionary<string, object?>
        {
            ["name"] = "First Steps",
            ["phase"] = "Reach orbit",
            ["started"] = true,
            ["finished"] = false,
            ["succeeded"] = false,
            ["scoreEnabled"] = true,
            ["score"] = 150.0,
            ["maxScore"] = 1000.0,
            ["objectives"] = new List<object?>
            {
                Objective("a", "Leave the pad", "Lift off from the pad", activated: true, active: false),
                Objective("b", "Reach orbit", null, activated: true, active: true),
                Objective("c", "Land safely", "Bring the crew home", activated: false, active: false),
            },
        };

        private static Dictionary<string, object?> Objective(string id, string title, string? description, bool activated, bool active) => new Dictionary<string, object?>
        {
            ["id"] = id,
            ["title"] = title,
            ["description"] = description,
            ["hasBeenActivated"] = activated,
            ["isActive"] = active,
        };

        private static void AssertEntryMirrors(Type type, Dictionary<string, object?> emitted)
        {
            var props = type
                .GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .ToDictionary(p => char.ToLower(p.Name[0], CultureInfo.InvariantCulture) + p.Name.Substring(1), p => p);

            Assert.Equal(
                props.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray(),
                emitted.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray());

            foreach (var (key, value) in emitted)
            {
                var prop = props[key];
                var expected = Nullable.GetUnderlyingType(prop.PropertyType) ?? prop.PropertyType;

                if (prop.PropertyType.IsValueType)
                {
                    Assert.True(
                        Nullable.GetUnderlyingType(prop.PropertyType) != null,
                        $"{type.Name}.{prop.Name} must be nullable to mirror SnapshotDict's null-on-absence rule.");
                }

                if (value is null)
                {
                    continue;
                }

                // A list of entries is checked by its own mirror test, and enums travel as their ordinal, so the provider emits an int.
                if (value is System.Collections.IEnumerable && value is not string)
                {
                    continue;
                }

                var matches = expected.IsEnum ? value is int : expected.IsInstanceOfType(value);
                Assert.True(matches, $"{type.Name}.{prop.Name} is {expected.Name} but the provider emitted {value.GetType().Name} for \"{key}\".");
            }
        }
    }
}
