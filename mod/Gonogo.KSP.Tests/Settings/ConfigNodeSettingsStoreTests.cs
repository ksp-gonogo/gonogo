using System;
using System.IO;
using Gonogo.KSP.Settings;
using Sitrep.Host.Settings;
using Xunit;

namespace Gonogo.KSP.Tests.Settings
{
    /// <summary>
    /// The settings document against a real file and KSP's real parser.
    ///
    /// <para>These assertions exist because the write path they replaced could
    /// not carry one. Its path came from <c>KSPUtil.ApplicationRootPath</c>,
    /// which reads a live Unity player, so headlessly the whole body threw into
    /// a catch that logged and returned, and a green run said nothing about
    /// whether a byte had ever been written. The path is a constructor argument
    /// now, so the bytes are the assertion.</para>
    /// </summary>
    public class ConfigNodeSettingsStoreTests : IDisposable
    {
        private readonly string _directory;
        private readonly string _path;

        public ConfigNodeSettingsStoreTests()
        {
            _directory = Path.Combine(Path.GetTempPath(), "gonogo-settings-" + Guid.NewGuid().ToString("N"));
            _path = Path.Combine(_directory, "PluginData", "gonogo.cfg");
        }

        public void Dispose()
        {
            try
            {
                if (Directory.Exists(_directory))
                {
                    Directory.Delete(_directory, recursive: true);
                }
            }
            catch (IOException)
            {
                // A temp directory the OS is still holding is not a test result.
            }
        }

        /// <summary>
        /// The file's actual contents, byte for byte. Everything else here
        /// could pass over a write that never happened; this one cannot.
        /// </summary>
        [Fact]
        public void ACommitPutsTheDocumentOnDisk()
        {
            var store = new SettingsStore(new ConfigNodeSettingsStore(_path, _ => { }));
            store.Declare(SettingsRow.Bool("SIGNAL_DELAY/enabled", true));
            store.Declare(SettingsRow.Number("SIGNAL_DELAY/lightSpeedScale", 1.0));
            store.Declare(SettingsRow.Bool("SIGNAL_DELAY/delayInSimulation", false));

            store.Stage("SIGNAL_DELAY/lightSpeedScale", 0.1);
            store.Stage("SIGNAL_DELAY/delayInSimulation", true);
            var outcome = store.Commit();

            Assert.True(outcome.Success, outcome.Reason);
            Assert.True(File.Exists(_path), _path + " was never written");
            Assert.Equal(
                "SIGNAL_DELAY\n"
                + "{\n"
                + "\tenabled = True\n"
                + "\tlightSpeedScale = 0.1\n"
                + "\tdelayInSimulation = True\n"
                + "}\n",
                File.ReadAllText(_path).Replace("\r\n", "\n"));
        }

        /// <summary>
        /// KSP's own parser reads back what was written. The writer and the
        /// reader are each other's inverse by construction only while both are
        /// <c>ConfigNode</c>, and that is the property worth pinning.
        /// </summary>
        [Fact]
        public void TheRealParserReadsBackWhatWasWritten()
        {
            var backing = new ConfigNodeSettingsStore(_path, _ => { });
            var store = new SettingsStore(backing);
            store.Declare(SettingsRow.Number("SIGNAL_DELAY/lightSpeedScale", 1.0));
            store.Declare(SettingsRow.Bool("RECORDING/enabled", false));
            store.Stage("SIGNAL_DELAY/lightSpeedScale", 0.1);
            store.Stage("RECORDING/enabled", true);
            store.Commit();

            var reopened = new SettingsStore(new ConfigNodeSettingsStore(_path, _ => { }));

            Assert.Equal(0.1, reopened.Number("SIGNAL_DELAY/lightSpeedScale"));
            Assert.Equal("True", reopened.Text("RECORDING/enabled"));
        }

        /// <summary>
        /// A block whose declarer did not run this launch is still on disk
        /// after a save, so an uplink that failed to load does not cost the
        /// operator its settings.
        /// </summary>
        [Fact]
        public void ABlockNothingDeclaredIsStillThereAfterASave()
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            File.WriteAllText(_path, "GHOST\n{\n\twrittenBy = 0.2.0\n\tsomeSetting = 12\n}\n");
            var store = new SettingsStore(new ConfigNodeSettingsStore(_path, _ => { }));
            store.Declare(SettingsRow.Bool("SIGNAL_DELAY/enabled", true));

            store.Stage("SIGNAL_DELAY/enabled", false);
            store.Commit();

            var written = File.ReadAllText(_path).Replace("\r\n", "\n");
            Assert.Contains("someSetting = 12", written);
            Assert.Contains("writtenBy = 0.2.0", written);
        }

        [Fact]
        public void AnAbsentFileReadsAsAnEmptyDocument()
        {
            var store = new SettingsStore(new ConfigNodeSettingsStore(_path, _ => { }));

            Assert.Null(store.Text("SIGNAL_DELAY/enabled"));
        }

        /// <summary>
        /// A path that cannot be written comes back as a failed outcome rather
        /// than a throw or a silence. The old write swallowed this case whole,
        /// which is what let a headless run report success over a file that was
        /// never touched.
        /// </summary>
        [Fact]
        public void AnUnwritablePathFailsAndSaysWhy()
        {
            // A file standing where the directory would have to go: creating
            // the containing directory cannot succeed, on every platform.
            var blocked = Path.Combine(_directory, "blocked");
            Directory.CreateDirectory(_directory);
            File.WriteAllText(blocked, "not a directory");
            var logged = new System.Collections.Generic.List<string>();
            var store = new SettingsStore(
                new ConfigNodeSettingsStore(Path.Combine(blocked, "gonogo.cfg"), logged.Add));
            store.Declare(SettingsRow.Bool("SIGNAL_DELAY/enabled", true));

            store.Stage("SIGNAL_DELAY/enabled", false);
            var outcome = store.Commit();

            Assert.False(outcome.Success);
            Assert.False(string.IsNullOrWhiteSpace(outcome.Reason));
            Assert.Single(logged);
            // The change is in force regardless: losing the file costs the
            // operator the value next launch, not this one.
            Assert.False(store.Bool("SIGNAL_DELAY/enabled"));
        }
    }
}
