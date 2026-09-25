using System;
using System.Collections.Generic;
using System.IO;
using Gonogo.KSP.Settings;
using Sitrep.Host.Settings;
using Xunit;

namespace Gonogo.KSP.Tests.Settings
{
    /// <summary>
    /// Preserve-unknown against a real file and KSP's real parser: what an
    /// operator types into <c>gonogo.cfg</c>, before the game starts or while
    /// it runs, is still there after the game saves.
    /// </summary>
    public class SettingsPreserveUnknownFileTests : IDisposable
    {
        private readonly string _directory;
        private readonly string _path;

        public SettingsPreserveUnknownFileTests()
        {
            _directory = Path.Combine(Path.GetTempPath(), "gonogo-preserve-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_directory);
            _path = Path.Combine(_directory, "gonogo.cfg");
        }

        public void Dispose()
        {
            try
            {
                Directory.Delete(_directory, recursive: true);
            }
            catch (IOException)
            {
                // A temp directory the OS is still holding is not a test result.
            }
        }

        private string Written() => File.ReadAllText(_path).Replace("\r\n", "\n");

        private SettingsStore Launch(List<string>? log = null)
        {
            var store = new SettingsStore(new ConfigNodeSettingsStore(_path, log == null ? (Action<string>)(_ => { }) : log.Add));
            store.Declare(SettingsRow.Bool("SIGNAL_DELAY/enabled", true));
            return store;
        }

        /// <summary>
        /// A same-length edit, made in the same second as the save before it,
        /// is exactly what a modification-time check cannot see. The store
        /// compares the file's bytes, so the edit survives.
        /// </summary>
        [Fact]
        public void ASameLengthHandEditBetweenSavesSurvives()
        {
            File.WriteAllText(_path, "GHOST\n{\n\tsomeSetting = 12\n}\n");
            var store = Launch();
            store.Stage("SIGNAL_DELAY/enabled", false);
            store.Commit();

            File.WriteAllText(_path, Written().Replace("someSetting = 12", "someSetting = 13"));
            store.Stage("SIGNAL_DELAY/enabled", true);
            var outcome = store.Commit();

            Assert.True(outcome.Success, outcome.Reason);
            Assert.Equal("13", ConfigNode.Load(_path)?.GetNode("GHOST")?.GetValue("someSetting"));
        }

        [Fact]
        public void ABlockAddedByHandWhileTheGameRunsSurvivesTheNextSave()
        {
            var store = Launch();
            store.Stage("SIGNAL_DELAY/enabled", false);
            store.Commit();

            File.AppendAllText(_path, "HANDADDED\n{\n\tflag = True\n}\n");
            store.Stage("SIGNAL_DELAY/enabled", true);
            store.Commit();

            Assert.Equal("True", ConfigNode.Load(_path)?.GetNode("HANDADDED")?.GetValue("flag"));
            Assert.Equal("True", ConfigNode.Load(_path)?.GetNode("SIGNAL_DELAY")?.GetValue("enabled"));
        }

        [Fact]
        public void ARepeatedValueNameInTheFileSurvivesASaveAsAList()
        {
            File.WriteAllText(_path, "LIST\n{\n\titem = a\n\titem = b\n\titem = c\n}\n");
            var store = Launch();

            store.Stage("SIGNAL_DELAY/enabled", false);
            store.Commit();

            Assert.Equal(new[] { "a", "b", "c" }, ConfigNode.Load(_path)?.GetNode("LIST")?.GetValues("item"));
        }

        /// <summary>
        /// Two blocks of one name: the first is the one read, as KSP reads it,
        /// the second is kept in the file, and the log says the second is being
        /// shadowed rather than letting it go unread in silence.
        /// </summary>
        [Fact]
        public void ADuplicateBlockIsKeptAndTheShadowingIsSaid()
        {
            File.WriteAllText(_path, "TWICE\n{\n\tx = first\n}\nTWICE\n{\n\tx = second\n}\n");
            var log = new List<string>();
            var store = Launch(log);

            Assert.Equal("first", store.Text("TWICE/x"));
            Assert.Contains(log, line => line.Contains("TWICE") && line.Contains("more than once"));

            store.Stage("SIGNAL_DELAY/enabled", false);
            store.Commit();

            Assert.Equal(2, ConfigNode.Load(_path)?.GetNodes("TWICE").Length);
        }

        /// <summary>
        /// A file deleted while the game runs says nothing about what the
        /// settings are, so the next save writes everything memory holds rather
        /// than only what it owns.
        /// </summary>
        [Fact]
        public void AFileDeletedMidSessionLosesNothingAtTheNextSave()
        {
            File.WriteAllText(_path, "GHOST\n{\n\tsomeSetting = 12\n}\n");
            var store = Launch();

            File.Delete(_path);
            store.Stage("SIGNAL_DELAY/enabled", false);
            store.Commit();

            Assert.Equal("12", ConfigNode.Load(_path)?.GetNode("GHOST")?.GetValue("someSetting"));
        }
    }
}
