using Sitrep.Host.Settings;
using Xunit;

namespace Sitrep.Host.Tests.Settings
{
    /// <summary>
    /// The screens' own settings, declared by the mod so the settings file is
    /// the one answer every screen reads.
    /// </summary>
    public class ConsoleSettingsTests
    {
        [Fact]
        public void EachRowIsNamedByTheIdTheScreensKnowItByWithTheScreensDefault()
        {
            var store = new SettingsStore(new InMemorySettingsStore());

            ConsoleSettings.Declare(store);

            Assert.True(store.Bool("CONSOLE/mission.historyEnabled"));
            Assert.False(store.Bool("CONSOLE/mission.recordAllTopics"));
            Assert.False(store.Bool("CONSOLE/mission.videoRecordingEnabled"));
            Assert.True(store.Bool("CONSOLE/sound.enabled"));
        }

        [Fact]
        public void AValueTheFileHoldsWinsOverTheDefault()
        {
            var backing = new InMemorySettingsStore();
            var seed = new SettingsStore(backing);
            seed.Declare(SettingsRow.Bool(ConsoleSettings.SoundEnabled, true));
            seed.Stage(ConsoleSettings.SoundEnabled, false);
            seed.Commit();

            var store = new SettingsStore(backing);
            ConsoleSettings.Declare(store);

            Assert.False(store.Bool(ConsoleSettings.SoundEnabled));
        }

        [Fact]
        public void EveryRowCarriesALabelAndADescription()
        {
            var store = new SettingsStore(new InMemorySettingsStore());

            ConsoleSettings.Declare(store);

            Assert.Equal(4, store.DeclaredRows.Count);
            foreach (var row in store.DeclaredRows)
            {
                Assert.NotEqual("", row.Label);
                Assert.NotEqual("", row.Description);
            }
        }
    }
}
