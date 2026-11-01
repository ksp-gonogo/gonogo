using System.Collections.Generic;
using System.Linq;
using Sitrep.Host.Hosting;
using Sitrep.Host.Settings;
using Xunit;

namespace Sitrep.Host.Tests.Hosting
{
    /// <summary>
    /// The host record, driven by a clock the test turns by hand so no grace
    /// is waited out. A "restart" builds a second record over the same settings
    /// backing, which is what the game starting again does.
    /// </summary>
    public class HostRecordTests
    {
        private sealed class Clock
        {
            public double Seconds { get; set; } = 1000.0;
        }

        private sealed class World
        {
            public Clock Clock { get; } = new Clock();

            public InMemorySettingsStore Backing { get; } = new InMemorySettingsStore();

            public List<string> Minted { get; } = new List<string>();

            public HostRecord Open()
            {
                var settings = new SettingsStore(Backing);
                return new HostRecord(
                    new SettingsHostRecordStore(settings),
                    () => Clock.Seconds,
                    () => 1_700_000_000_000L + (long)(Clock.Seconds * 1000),
                    mintCode: () =>
                    {
                        var code = HostRecord.MintCode();
                        Minted.Add(code);
                        return code;
                    });
            }
        }

        [Fact]
        public void TheGenerationRisesByOneOnEachGrant_ANewHolderAndTheSameHolderReturning()
        {
            var world = new World();
            var record = world.Open();

            Assert.Equal(1, record.Claim("tab-a", "conn-1").Generation);

            record.ConnectionClosed("conn-1");
            Assert.Equal(2, record.Claim("tab-a", "conn-2").Generation);

            record.Release("tab-a");
            Assert.Equal(3, record.Claim("tab-b", "conn-3").Generation);
        }

        [Fact]
        public void TheGenerationDoesNotMoveOnAHeartbeatOrARefusedClaim()
        {
            var world = new World();
            var record = world.Open();
            var granted = record.Claim("tab-a", "conn-1");

            world.Clock.Seconds += 5;
            var beat = record.Heartbeat("tab-a", "conn-1");
            var refused = record.Claim("tab-b", "conn-2");

            Assert.Equal(granted.Generation, beat.Generation);
            Assert.Equal(granted.Generation, refused.Generation);
        }

        [Fact]
        public void TheGenerationKeepsRisingAcrossARestart()
        {
            var world = new World();
            var first = world.Open();
            first.Claim("tab-a", "conn-1");
            first.Claim("tab-a", "conn-1");

            var second = world.Open();

            Assert.Equal(3, second.Claim("tab-a", "conn-9").Generation);
        }

        [Fact]
        public void TheFirstClaimIsGranted()
        {
            var record = new World().Open();

            var outcome = record.Claim("tab-a", "conn-1");

            Assert.True(outcome.Holds);
            Assert.Equal(HostRecord.PublicId("tab-a"), outcome.HolderId);
        }

        [Fact]
        public void ASecondTokenIsRefusedWhileTheHolderHeartbeats_AndTheRefusalNamesTheHolder()
        {
            var world = new World();
            var record = world.Open();
            record.Claim("tab-a", "conn-1");

            for (var i = 0; i < 6; i++)
            {
                world.Clock.Seconds += 5;
                Assert.True(record.Heartbeat("tab-a", "conn-1").Holds);
            }

            var refused = record.Claim("tab-b", "conn-2");

            Assert.False(refused.Holds);
            Assert.Equal(HostRecord.PublicId("tab-a"), refused.HolderId);
        }

        [Fact]
        public void AHolderThatGoesSilentPastTheGraceIsFreed_AndANewTokenCanClaim()
        {
            var world = new World();
            var record = world.Open();
            record.Claim("tab-a", "conn-1");

            world.Clock.Seconds += record.Timings.GraceSeconds - 1;
            Assert.False(record.Claim("tab-b", "conn-2").Holds);

            world.Clock.Seconds += 2;
            var taken = record.Claim("tab-b", "conn-2");

            Assert.True(taken.Holds);
            Assert.Equal(HostRecord.PublicId("tab-b"), record.HolderId);
        }

        [Fact]
        public void AHolderWhoseConnectionClosesKeepsTheRoleForTheGraceAndTheSameTokenTakesItStraightBack()
        {
            var world = new World();
            var record = world.Open();
            record.Claim("tab-a", "conn-1");
            world.Clock.Seconds += 4;

            record.ConnectionClosed("conn-1");
            Assert.True(record.HolderAway);
            world.Clock.Seconds += 10;
            var back = record.Claim("tab-a", "conn-2");

            Assert.True(back.Holds);
            Assert.False(record.HolderAway);
        }

        [Fact]
        public void TheGraceRunsFromTheCloseOfTheConnection_NotFromTheLastHeartbeat()
        {
            var world = new World();
            var record = world.Open();
            record.Claim("tab-a", "conn-1");
            world.Clock.Seconds += 12;
            record.ConnectionClosed("conn-1");

            world.Clock.Seconds += 14;

            Assert.False(record.Claim("tab-b", "conn-2").Holds);
            world.Clock.Seconds += 2;
            Assert.True(record.Claim("tab-b", "conn-2").Holds);
        }

        [Fact]
        public void ADifferentTokenInsideTheGrace_ADuplicatedTab_IsRefused()
        {
            var world = new World();
            var record = world.Open();
            record.Claim("tab-a", "conn-1");
            record.ConnectionClosed("conn-1");
            world.Clock.Seconds += 3;

            var refused = record.Claim("tab-b", "conn-2");

            Assert.False(refused.Holds);
            Assert.Equal(HostRecord.PublicId("tab-a"), refused.HolderId);
        }

        [Fact]
        public void ACloseOfSomeOtherConnectionStartsNoGrace()
        {
            var world = new World();
            var record = world.Open();
            record.Claim("tab-a", "conn-1");

            record.ConnectionClosed("conn-9");

            Assert.False(record.HolderAway);
        }

        [Fact]
        public void TheOldHolderIsToldItNoLongerHoldsTheRoleOnItsNextHeartbeat()
        {
            var world = new World();
            var record = world.Open();
            record.Claim("tab-a", "conn-1");
            world.Clock.Seconds += record.Timings.GraceSeconds + 1;
            record.Claim("tab-b", "conn-2");

            var late = record.Heartbeat("tab-a", "conn-1");

            Assert.False(late.Holds);
            Assert.Equal(HostRecord.PublicId("tab-b"), late.HolderId);
        }

        [Fact]
        public void AHeartbeatFromAnyTokenWhenNobodyHoldsTheRoleSaysSo()
        {
            var record = new World().Open();

            var outcome = record.Heartbeat("tab-a", "conn-1");

            Assert.False(outcome.Holds);
            Assert.Null(outcome.HolderId);
        }

        [Fact]
        public void ReleaseFreesTheRoleAtOnce_AndOnlyForTheHolder()
        {
            var world = new World();
            var record = world.Open();
            record.Claim("tab-a", "conn-1");

            Assert.False(record.Release("tab-b"));
            Assert.True(record.Held);
            Assert.True(record.Release("tab-a"));

            Assert.False(record.Held);
            Assert.True(record.Claim("tab-b", "conn-2").Holds);
        }

        [Fact]
        public void AfterARestart_TheLastHoldersTokenClaimsFirst_AndAnotherTokenIsRefusedUntilTheWindowEnds()
        {
            var world = new World();
            var before = world.Open();
            before.Claim("tab-a", "conn-1");

            var after = world.Open();
            after.NoteConnection();
            world.Clock.Seconds += 5;

            var other = after.Claim("tab-b", "conn-2");
            Assert.False(other.Holds);
            Assert.Equal(HostRecord.PublicId("tab-a"), other.HolderId);

            Assert.True(after.Claim("tab-a", "conn-3").Holds);
        }

        [Fact]
        public void AfterARestart_AnotherTokenClaimsOnceTheWindowHasEnded()
        {
            var world = new World();
            world.Open().Claim("tab-a", "conn-1");

            var after = world.Open();
            after.NoteConnection();
            world.Clock.Seconds += after.Timings.RestartSeconds + 1;

            Assert.True(after.Claim("tab-b", "conn-2").Holds);
        }

        [Fact]
        public void TheRestartWindowOpensAtTheFirstConnection_NotAtConstruction()
        {
            var world = new World();
            world.Open().Claim("tab-a", "conn-1");

            var after = world.Open();
            world.Clock.Seconds += 600;
            after.NoteConnection();
            world.Clock.Seconds += 5;

            Assert.False(after.Claim("tab-b", "conn-2").Holds);
        }

        [Fact]
        public void AFirstEverStartHasNoRestartWindow()
        {
            var world = new World();
            var record = world.Open();
            record.NoteConnection();

            Assert.True(record.Claim("tab-b", "conn-2").Holds);
        }

        [Fact]
        public void TheCodeIsMintedOnceWithTheShareCodeForm_SurvivesARestart_AndChangesOnlyOnRegenerate()
        {
            var world = new World();
            var record = world.Open();

            var first = record.Code;
            Assert.Equal(first, record.Code);
            Assert.True(HostRecord.IsCodeForm(first));
            Assert.Single(world.Minted);

            var restarted = world.Open();
            Assert.Equal(first, restarted.Code);
            Assert.Single(world.Minted);

            restarted.Claim("tab-a", "conn-1");
            Assert.True(restarted.RegenerateCode("tab-a"));
            var second = restarted.Code;
            Assert.NotEqual(first, second);
            Assert.True(HostRecord.IsCodeForm(second));
            Assert.Equal(second, world.Open().Code);
        }

        [Fact]
        public void ANonHolderCannotRegenerateTheCode()
        {
            var world = new World();
            var record = world.Open();
            record.Claim("tab-a", "conn-1");
            var code = record.Code;

            Assert.False(record.RegenerateCode("tab-b"));

            Assert.Equal(code, record.Code);
        }

        [Fact]
        public void AStoredCodeOfTheWrongFormIsReplaced()
        {
            var world = new World();
            var settings = new SettingsStore(world.Backing);
            settings.Stage(SettingsHostRecordStore.CodePath, "abc");
            settings.Commit();

            var record = world.Open();

            Assert.True(HostRecord.IsCodeForm(record.Code));
        }

        [Fact]
        public void MintedCodesUseOnlyTheShareCodeAlphabet()
        {
            for (var i = 0; i < 200; i++)
            {
                Assert.True(HostRecord.IsCodeForm(HostRecord.MintCode()));
            }
        }

        [Fact]
        public void ApproveAndRevokePersistAcrossARestart()
        {
            var world = new World();
            var record = world.Open();
            record.Claim("tab-a", "conn-1");

            Assert.True(record.ApproveStation("tab-a", "cred-1", "Pilot tablet"));
            Assert.True(record.ApproveStation("tab-a", "cred-2", "Flight director, with // and ; and , in it"));

            var restarted = world.Open();
            Assert.Equal(new[] { "Pilot tablet", "Flight director, with // and ; and , in it" }, restarted.Stations.Select(s => s.Name));
            Assert.NotNull(restarted.FindStation("cred-1"));

            restarted.Claim("tab-a", "conn-1");
            Assert.True(restarted.RevokeStation("tab-a", HostRecord.PublicId("cred-1")));

            var again = world.Open();
            Assert.Null(again.FindStation("cred-1"));
            Assert.NotNull(again.FindStation("cred-2"));
        }

        [Fact]
        public void ANonHoldersApproveAndRevokeAreRefusedAndChangeNothing()
        {
            var world = new World();
            var record = world.Open();
            record.Claim("tab-a", "conn-1");
            record.ApproveStation("tab-a", "cred-1", "Pilot tablet");

            Assert.False(record.ApproveStation("tab-b", "cred-2", "Intruder"));
            Assert.False(record.RevokeStation("tab-b", HostRecord.PublicId("cred-1")));

            Assert.Single(record.Stations);
            Assert.NotNull(record.FindStation("cred-1"));
        }

        [Fact]
        public void ApprovingAnApprovedStationAgainRenamesItAndKeepsWhenItWasApproved()
        {
            var world = new World();
            var record = world.Open();
            record.Claim("tab-a", "conn-1");
            record.ApproveStation("tab-a", "cred-1", "Tablet");
            var at = record.FindStation("cred-1")!.ApprovedAtUnixMs;
            world.Clock.Seconds += 10;

            record.ApproveStation("tab-a", "cred-1", "Pilot tablet");

            Assert.Single(record.Stations);
            Assert.Equal("Pilot tablet", record.FindStation("cred-1")!.Name);
            Assert.Equal(at, record.FindStation("cred-1")!.ApprovedAtUnixMs);
        }

        [Fact]
        public void ApprovedStationsStayApprovedWhicheverScreenHostsNext()
        {
            var world = new World();
            var record = world.Open();
            record.Claim("tab-a", "conn-1");
            record.ApproveStation("tab-a", "cred-1", "Tablet");
            record.Release("tab-a");

            record.Claim("tab-b", "conn-2");

            Assert.NotNull(record.FindStation("cred-1"));
        }

        [Fact]
        public void ThePublicIdRevealsNeitherSecretAndIsStable()
        {
            var id = HostRecord.PublicId("a-secret-credential");

            Assert.Equal(id, HostRecord.PublicId("a-secret-credential"));
            Assert.DoesNotContain("secret", id);
            Assert.NotEqual(id, HostRecord.PublicId("another-credential"));
        }

        private static IEnumerable<string> Everything(object? node)
        {
            switch (node)
            {
                case IDictionary<string, object?> map:
                    foreach (var pair in map)
                    {
                        yield return pair.Key;
                        foreach (var inner in Everything(pair.Value))
                        {
                            yield return inner;
                        }
                    }

                    break;
                case System.Collections.IEnumerable list when !(node is string):
                    foreach (var item in list)
                    {
                        foreach (var inner in Everything(item))
                        {
                            yield return inner;
                        }
                    }

                    break;
                case null:
                    break;
                default:
                    yield return node.ToString() ?? string.Empty;
                    break;
            }
        }

        [Fact]
        public void NeitherTheTokenNorACredentialIsReachableThroughTheSettingsChannel()
        {
            var world = new World();
            var settings = new SettingsStore(world.Backing);
            var record = new HostRecord(new SettingsHostRecordStore(settings), () => world.Clock.Seconds, () => 0L);
            record.Claim("tab-a-secret-token", "conn-1");
            record.ApproveStation("tab-a-secret-token", "station-secret-credential", "Tablet");
            var publisher = new SettingsPublisher(settings, () => new Dictionary<string, string>(), () => 0.0);

            var wire = string.Join("|", Everything(publisher.Snapshot));

            Assert.DoesNotContain("secret", wire);
            Assert.DoesNotContain("JoinCode", wire);
        }
    }
}
