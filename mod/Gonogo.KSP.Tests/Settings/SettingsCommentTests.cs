using System;
using System.IO;
using Gonogo.KSP.Settings;
using Sitrep.Host.Settings;
using Xunit;

namespace Gonogo.KSP.Tests.Settings
{
    /// <summary>
    /// The comments in <c>gonogo.cfg</c> are generated, not kept. KSP's reader
    /// drops every comment, so one typed by hand cannot survive a save; the ones
    /// a save writes come from each declared row, the header says so, and a note
    /// worth keeping lives in a value.
    /// </summary>
    public class SettingsCommentTests : IDisposable
    {
        private readonly string _directory;
        private readonly string _path;

        public SettingsCommentTests()
        {
            _directory = Path.Combine(Path.GetTempPath(), "gonogo-comments-" + Guid.NewGuid().ToString("N"));
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

        [Fact]
        public void EachDeclaredRowIsWrittenWithItsLabelAndTheFileSaysCommentsAreGenerated()
        {
            var store = new SettingsStore(new ConfigNodeSettingsStore(_path, _ => { }));
            store.Declare(SettingsRow.Bool("SIGNAL_DELAY/enabled", true, "Apply light-time delay"));
            store.Stage("SIGNAL_DELAY/enabled", false);
            store.Commit();

            var written = Written();
            Assert.StartsWith("// " + ConfigNodeSettingsStore.Header + "\n", written);
            Assert.Contains("\tenabled = False // Apply light-time delay. True or False, default True\n", written);
        }

        /// <summary>A comment says what a row is and never changes what KSP reads back.</summary>
        [Fact]
        public void TheRealReaderSeesNoneOfTheComments()
        {
            var store = new SettingsStore(new ConfigNodeSettingsStore(_path, _ => { }));
            store.Declare(SettingsRow.Number("SIGNAL_DELAY/lightSpeedScale", 1.0, "One-way light time as a fraction of c"));
            store.Stage("SIGNAL_DELAY/lightSpeedScale", 0.1);
            store.Commit();

            Assert.Equal("0.1", ConfigNode.Load(_path)?.GetNode("SIGNAL_DELAY")?.GetValue("lightSpeedScale"));
        }

        /// <summary>
        /// The decided behaviour, pinned so it reads as a decision: a comment
        /// typed into the file is gone after a save, and a note kept as a value
        /// is not.
        /// </summary>
        [Fact]
        public void AHandTypedCommentIsGoneAfterASaveAndANotesValueIsKept()
        {
            File.WriteAllText(_path,
                "SIGNAL_DELAY\n{\n\tlightSpeedScale = 0.1 // typed by hand\n"
                + "\tlightSpeedScale.notes = 0.1c puts Minmus at 1.6s one-way\n}\n");
            var store = new SettingsStore(new ConfigNodeSettingsStore(_path, _ => { }));
            store.Declare(SettingsRow.Number("SIGNAL_DELAY/lightSpeedScale", 1.0, "One-way light time as a fraction of c"));
            store.Declare(SettingsRow.Bool("SIGNAL_DELAY/enabled", true));
            store.Stage("SIGNAL_DELAY/enabled", false);
            store.Commit();

            var written = Written();
            Assert.DoesNotContain("typed by hand", written);
            Assert.Contains("\tlightSpeedScale.notes = 0.1c puts Minmus at 1.6s one-way\n", written);
            Assert.Contains("\tlightSpeedScale = 0.1 // One-way light time as a fraction of c", written);
        }

        /// <summary>
        /// A label with a line break in it would end the comment and start a row
        /// nobody wrote. The comment is folded to one line, so the file reads
        /// back as the rows that were meant.
        /// </summary>
        [Fact]
        public void ALabelWithALineBreakCannotAddARow()
        {
            var store = new SettingsStore(new ConfigNodeSettingsStore(_path, _ => { }));
            store.Declare(SettingsRow.Bool("SIGNAL_DELAY/enabled", true, "Apply delay\ninjected = True"));
            store.Stage("SIGNAL_DELAY/enabled", false);
            store.Commit();

            var node = ConfigNode.Load(_path)?.GetNode("SIGNAL_DELAY");
            Assert.NotNull(node);
            Assert.Null(node!.GetValue("injected"));
            Assert.Equal("False", node.GetValue("enabled"));
        }
    }
}
