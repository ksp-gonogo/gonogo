using System;
using System.Collections.Generic;
using System.Reflection;
using Sitrep.Contract;
using Sitrep.Host;
using Xunit;

namespace Gonogo.KSP.Tests.Comms
{
    /// <summary>
    /// That a craft with no charge loses its link only when the save's "No
    /// charge, no link" setting is on. Off, which a new save starts with, the
    /// power reader reads no craft and every link is the network's. An Uplink
    /// that locks the setting holds it at its value, greyed out, without
    /// changing the player's own choice in the save.
    /// </summary>
    [Collection(CommsCoreUplinkStatics.Name)]
    public class TelemetryRequiresChargeSettingTests
    {
        [Fact]
        public void ANewSaveLeavesEveryLinkToTheNetwork()
        {
            Assert.False(new GonogoGameParameters().telemetryRequiresCharge);
        }

        [Fact]
        public void TheSettingIsAToggleOnTheDifficultyScreen()
        {
            var field = typeof(GonogoGameParameters).GetField(nameof(GonogoGameParameters.telemetryRequiresCharge))!;
            Assert.NotNull(field.GetCustomAttribute<GameParameters.CustomParameterUI>());
        }

        [Fact]
        public void WithTheSettingOffNoCraftIsReadForPower()
        {
            WithSave(on: false, () => Assert.False(CraftPowerBook.RuleOnInSave()));
        }

        [Fact]
        public void WithTheSettingOnEveryCraftIsReadForPower()
        {
            WithSave(on: true, () => Assert.True(CraftPowerBook.RuleOnInSave()));
        }

        [Fact]
        public void WithNoSaveLoadedNoCraftIsReadForPower()
        {
            var previousFetch = HighLogic.fetch;
            try
            {
                HighLogic.fetch = UnityStandIns.Alive<HighLogic>();
                HighLogic.CurrentGame = null;
                Assert.False(CraftPowerBook.RuleOnInSave());
            }
            finally
            {
                HighLogic.fetch = previousFetch;
            }
        }

        [Fact]
        public void UnlockedThePlayerCanChangeTheSetting()
        {
            var node = new GonogoGameParameters();

            Assert.True(node.Interactible(TelemetryRequiresCharge, null!));
            Assert.Equal(GonogoGameParameters.TelemetryRequiresChargeTooltip, GonogoGameParameters.TelemetryRequiresChargeTooltipFor(null));
            Assert.False(node.Enabled(LockLine, null!));
            Assert.Equal("", node.telemetryRequiresChargeLock);
        }

        [Fact]
        public void LockedALineUnderTheSettingNamesTheUplinkAndItsReason()
        {
            WithLock(on: true, () =>
            {
                var node = new GonogoGameParameters();

                Assert.True(node.Enabled(LockLine, null!));
                Assert.True(node.Enabled(TelemetryRequiresCharge, null!));
                Assert.Equal("Set on by the Example Mod Uplink: Example Mod decides it", node.telemetryRequiresChargeLock);
            });
        }

        [Fact]
        public void TheLockLineIsNeverWrittenToTheSave()
        {
            WithLock(on: true, () =>
            {
                var saved = new ConfigNode("GONOGO");
                new GonogoGameParameters().Save(saved);

                Assert.False(saved.HasValue(nameof(GonogoGameParameters.telemetryRequiresChargeLock)));
            });
        }

        [Fact]
        public void LockedTheSettingIsGreyedOutAtTheUplinksValue()
        {
            WithLock(on: true, () =>
            {
                var node = new GonogoGameParameters();

                Assert.False(node.Interactible(TelemetryRequiresCharge, null!));
                Assert.True(node.telemetryRequiresCharge);
                Assert.True(node.Interactible(typeof(GonogoGameParameters).GetField(nameof(GonogoGameParameters.signalDelay))!, null!));
            });
        }

        [Fact]
        public void LockedOnEveryCraftIsReadForPowerWhateverTheSaveSays()
        {
            WithLock(on: true, () => WithSave(on: false, () => Assert.True(CraftPowerBook.RuleOnInSave())));
        }

        [Fact]
        public void LockedTheSaveKeepsThePlayersOwnChoice()
        {
            WithLock(on: true, () =>
            {
                var stored = new ConfigNode("GONOGO");
                stored.AddValue(nameof(GonogoGameParameters.telemetryRequiresCharge), "False");
                var node = new GonogoGameParameters();
                node.Load(stored);
                Assert.True(node.telemetryRequiresCharge);

                var saved = new ConfigNode("GONOGO");
                node.Save(saved);

                Assert.Equal("False", saved.GetValue(nameof(GonogoGameParameters.telemetryRequiresCharge)));
            });
        }

        [Fact]
        public void ASaveThatNeverChoseGetsTheDefaultBackOnceTheLockIsGone()
        {
            var saved = new ConfigNode("GONOGO");
            WithLock(on: true, () =>
            {
                var node = new GonogoGameParameters();
                node.Load(new ConfigNode("GONOGO"));
                Assert.True(node.telemetryRequiresCharge);

                node.Save(saved);
            });

            var reloaded = new GonogoGameParameters();
            reloaded.Load(saved);

            Assert.False(reloaded.telemetryRequiresCharge);
        }

        [Fact]
        public void LockedTheTooltipNamesTheUplinkAndItsReason()
        {
            var held = new CoreSettingLock(CoreSettings.TelemetryRequiresCharge, true, "exampleantennas", "Example Antennas",
                "Example Antennas already cuts the link of a craft with no charge");

            Assert.Equal(
                "Set on by the Example Antennas Uplink: Example Antennas already cuts the link of a craft with no charge",
                GonogoGameParameters.TelemetryRequiresChargeTooltipFor(held));
        }

        [Fact]
        public void TheAppListsTheSettingBesideSignalDelayTaggedForSetup()
        {
            var listed = Assert.Single(new CommsCoreUplink().ListModSettings(), s => s.Id == CommsDelayModSettings.TelemetryRequiresChargeId);

            Assert.Equal("Vessel telemetry requires vessel charge", listed.Label);
            Assert.Equal(SettingKind.Bool, listed.Kind);
            Assert.True(listed.Writable);
            Assert.Contains(SettingTags.Setup, listed.Tags);
        }

        [Fact]
        public void TheAppReadsAndWritesTheLoadedSavesChoice()
        {
            WithSave(on: false, () =>
            {
                var uplink = new CommsCoreUplink();
                Assert.False(uplink.ReadModSetting(CommsDelayModSettings.TelemetryRequiresChargeId).AsBool);

                var result = uplink.WriteModSetting(CommsDelayModSettings.TelemetryRequiresChargeId, ModSettingValue.Of(true));

                Assert.True(result.Success);
                Assert.True(HighLogic.CurrentGame.Parameters.CustomParams<GonogoGameParameters>().telemetryRequiresCharge);
                var read = uplink.ReadModSetting(CommsDelayModSettings.TelemetryRequiresChargeId);
                Assert.True(read.AsBool);
                Assert.Null(read.LockedBy);
            });
        }

        [Fact]
        public void LockedTheAppReadsTheUplinksValueWithItsNameEvenWithNoSave()
        {
            WithLock(on: true, () =>
            {
                var previousFetch = HighLogic.fetch;
                try
                {
                    HighLogic.fetch = UnityStandIns.Alive<HighLogic>();
                    HighLogic.CurrentGame = null;
                    var uplink = new CommsCoreUplink();

                    var read = uplink.ReadModSetting(CommsDelayModSettings.TelemetryRequiresChargeId);
                    var write = uplink.WriteModSetting(CommsDelayModSettings.TelemetryRequiresChargeId, ModSettingValue.Of(false));

                    Assert.True(read.AsBool);
                    Assert.Equal("Example Mod", read.LockedBy);
                    Assert.Equal("Example Mod decides it", read.LockReason);
                    Assert.False(write.Success);
                    Assert.Contains("Example Mod", write.Detail);
                }
                finally
                {
                    HighLogic.fetch = previousFetch;
                }
            });
        }

        private static readonly FieldInfo LockLine =
            typeof(GonogoGameParameters).GetField(nameof(GonogoGameParameters.telemetryRequiresChargeLock))!;

        private static readonly FieldInfo TelemetryRequiresCharge =
            typeof(GonogoGameParameters).GetField(nameof(GonogoGameParameters.telemetryRequiresCharge))!;

        private static void WithLock(bool on, Action body)
        {
            var held = new CoreSettingLock(CoreSettings.TelemetryRequiresCharge, on, "example", "Example Mod", "Example Mod decides it");
            GonogoGameParameters.UseLocks(setting => setting == CoreSettings.TelemetryRequiresCharge ? held : null);
            try
            {
                body();
            }
            finally
            {
                GonogoGameParameters.UseLocks(_ => null);
            }
        }

        private static void WithSave(bool on, Action body)
        {
            var previousFetch = HighLogic.fetch;
            try
            {
                AssemblyLoader.loadedAssemblies ??= new AssemblyLoader.LoadedAssembyList();
                var game = (Game)System.Runtime.CompilerServices.RuntimeHelpers.GetUninitializedObject(typeof(Game));
                game.Parameters = new GameParameters();
                var nodes = (Dictionary<Type, GameParameters.CustomParameterNode>)typeof(GameParameters)
                    .GetField("customParams", BindingFlags.NonPublic | BindingFlags.Instance)!
                    .GetValue(game.Parameters)!;
                nodes[typeof(GonogoGameParameters)] = new GonogoGameParameters { telemetryRequiresCharge = on };
                HighLogic.fetch = UnityStandIns.Alive<HighLogic>();
                HighLogic.CurrentGame = game;
                body();
            }
            finally
            {
                HighLogic.fetch = previousFetch;
            }
        }
    }
}
