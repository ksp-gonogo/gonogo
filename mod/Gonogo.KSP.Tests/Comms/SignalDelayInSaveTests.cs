using System;
using System.Collections.Generic;
using System.Reflection;
using Sitrep.Contract;
using Sitrep.Host.Settings;
using Xunit;

namespace Gonogo.KSP.Tests.Comms
{
    /// <summary>
    /// That the signal delay choice is the save's: the difficulty-settings node
    /// is the one value, the app's mod-setting rows read and write it, and a
    /// light speed that would mean an infinite delay cannot be entered or held.
    /// </summary>
    [Collection(CommsCoreUplinkStatics.Name)]
    public class SignalDelayInSaveTests
    {
        [Fact]
        public void ANewSaveHoldsDelayOnAtRealLightSpeed()
        {
            var node = new GonogoGameParameters();

            Assert.True(node.signalDelay);
            Assert.Equal(1f, node.lightSpeedScale);
        }

        [Fact]
        public void TheNodeIsAGonogoSectionOfTheDifficultySettings()
        {
            var node = new GonogoGameParameters();

            Assert.Equal("Gonogo", node.Section);
            Assert.Equal("Gonogo", node.DisplaySection);
            Assert.DoesNotContain("Sitrep", node.Title + node.Section);
            var scale = typeof(GonogoGameParameters).GetField(nameof(GonogoGameParameters.lightSpeedScale))!;
            var ui = scale.GetCustomAttribute<GameParameters.CustomFloatParameterUI>()!;
            Assert.True(ui.minValue > 0f, "the in-game slider must not reach zero");
        }

        [Fact]
        public void TheSavesChoiceIsTakenIntoForceWithinAFrame()
        {
            WithSave(enabled: false, scale: 0.5f, node =>
            {
                CommsCoreUplink.SyncSignalDelayFromSave();

                Assert.False(CommsCoreUplink.AuthoredSignalDelayConfig.Enabled);
                Assert.Equal(0.5, CommsCoreUplink.AuthoredSignalDelayConfig.LightSpeedScale);

                node.signalDelay = true;
                CommsCoreUplink.SyncSignalDelayFromSave();

                Assert.True(CommsCoreUplink.AuthoredSignalDelayConfig.Enabled);
            });
        }

        [Fact]
        public void AWriteFromTheAppChangesTheNodeAndIsInForceAtOnce()
        {
            WithSave(enabled: true, scale: 1f, node =>
            {
                var uplink = new CommsCoreUplink();

                var result = uplink.WriteModSetting(CommsDelayModSettings.EnabledId, ModSettingValue.Of(false));

                Assert.True(result.Success);
                Assert.False(node.signalDelay);
                Assert.False(CommsCoreUplink.AuthoredSignalDelayConfig.Enabled);
                Assert.False(uplink.ReadModSetting(CommsDelayModSettings.EnabledId).AsBool);
            });
        }

        [Fact]
        public void AnEditInTheGameShowsInTheAppRows()
        {
            WithSave(enabled: true, scale: 1f, node =>
            {
                node.lightSpeedScale = 0.25f;

                var read = new CommsCoreUplink().ReadModSetting(CommsDelayModSettings.LightSpeedScaleId);

                Assert.Equal(0.25, read.AsNumber);
            });
        }

        [Theory]
        [InlineData(0.0)]
        [InlineData(-1.0)]
        [InlineData(double.NaN)]
        public void ALightSpeedOfZeroOrLessIsRefusedWithASentencePointingAtTheSwitch(double scale)
        {
            WithSave(enabled: true, scale: 1f, node =>
            {
                var result = new CommsCoreUplink().WriteModSetting(
                    CommsDelayModSettings.LightSpeedScaleId, ModSettingValue.Of(scale));

                Assert.False(result.Success);
                Assert.Contains("Signal delay switch", result.Detail);
                Assert.Equal(1f, node.lightSpeedScale);
            });
        }

        [Fact]
        public void ALightSpeedOutsideTheSlidersRangeIsRefused()
        {
            WithSave(enabled: true, scale: 1f, node =>
            {
                var uplink = new CommsCoreUplink();

                Assert.False(uplink.WriteModSetting(CommsDelayModSettings.LightSpeedScaleId, ModSettingValue.Of(0.001)).Success);
                Assert.False(uplink.WriteModSetting(CommsDelayModSettings.LightSpeedScaleId, ModSettingValue.Of(1000.0)).Success);
                Assert.True(uplink.WriteModSetting(CommsDelayModSettings.LightSpeedScaleId, ModSettingValue.Of(0.5)).Success);
                Assert.Equal(0.5f, node.lightSpeedScale);
            });
        }

        [Fact]
        public void ABadStoredLightSpeedIsHeldAsRealLightSpeed()
        {
            WithSave(enabled: true, scale: 0f, _ =>
            {
                CommsCoreUplink.SyncSignalDelayFromSave();

                Assert.Equal(1.0, CommsCoreUplink.AuthoredSignalDelayConfig.LightSpeedScale);
            });
        }

        [Fact]
        public void WithNoSaveTheRowsSayWhyTheyCannotBeRead()
        {
            var previousFetch = HighLogic.fetch;
            HighLogic.fetch = UnityStandIns.Alive<HighLogic>();
            try
            {
                var uplink = new CommsCoreUplink();

                var read = uplink.ReadModSetting(CommsDelayModSettings.EnabledId);
                var write = uplink.WriteModSetting(CommsDelayModSettings.EnabledId, ModSettingValue.Of(false));

                Assert.False(read.IsAvailable);
                Assert.Contains("no save", read.UnavailableReason);
                Assert.False(write.Success);
            }
            finally
            {
                HighLogic.fetch = previousFetch;
            }
        }

        [Fact]
        public void BothRowsAreOfferedToBeWrittenAndNameWhereTheyAreSetInGame()
        {
            foreach (var setting in new CommsCoreUplink().ListModSettings())
            {
                Assert.True(setting.Writable);
                Assert.Contains("Gonogo", setting.SetIn);
                Assert.DoesNotContain("Sitrep", setting.Label + setting.Description + setting.SetIn);
                Assert.DoesNotContain("Uplink", setting.Label + setting.Description + setting.SetIn);
            }
        }

        [Fact]
        public void AnOldSignalDelayBlockInTheFileIsNamedOnceAndNotRead()
        {
            var document = new SettingsDocument();
            document.Root.BlockOrAdd("SIGNAL_DELAY").SetValue("enabled", "False");
            var store = new SettingsStore(new InMemorySettingsStore(document));
            var logged = new List<string>();

            CommsCoreUplink.NoteLegacySettings(store, logged.Add);

            var line = Assert.Single(logged);
            Assert.Contains("SIGNAL_DELAY", line);
            Assert.Contains("Difficulty settings", line);
        }

        [Fact]
        public void AFileWithoutTheOldBlockSaysNothing()
        {
            var store = new SettingsStore(new InMemorySettingsStore());
            var logged = new List<string>();

            CommsCoreUplink.NoteLegacySettings(store, logged.Add);

            Assert.Empty(logged);
        }

        private static void WithSave(bool enabled, float scale, Action<GonogoGameParameters> body)
        {
            var previousFetch = HighLogic.fetch;
            var previousConfig = CommsCoreUplink.AuthoredSignalDelayConfig;
            try
            {
                AssemblyLoader.loadedAssemblies ??= new AssemblyLoader.LoadedAssembyList();
                var game = (Game)System.Runtime.CompilerServices.RuntimeHelpers.GetUninitializedObject(typeof(Game));
                game.Parameters = new GameParameters();
                var node = new GonogoGameParameters { signalDelay = enabled, lightSpeedScale = scale };
                var nodes = (Dictionary<Type, GameParameters.CustomParameterNode>)typeof(GameParameters)
                    .GetField("customParams", BindingFlags.NonPublic | BindingFlags.Instance)!
                    .GetValue(game.Parameters)!;
                nodes[typeof(GonogoGameParameters)] = node;
                HighLogic.fetch = UnityStandIns.Alive<HighLogic>();
                HighLogic.CurrentGame = game;
                CommsCoreUplink.ConfigureSignalDelay(new Sitrep.Host.Comms.SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 });
                body(node);
            }
            finally
            {
                HighLogic.fetch = previousFetch;
                CommsCoreUplink.ConfigureSignalDelay(previousConfig);
            }
        }
    }
}
