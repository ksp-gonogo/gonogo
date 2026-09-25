using System;
using System.IO;
using Gonogo.KSP.Settings;
using Sitrep.Host.Settings;
using Xunit;

namespace Gonogo.KSP.Tests.Settings
{
    /// <summary>
    /// The real parser's half of the settings encoding rule: each spelling
    /// <see cref="SettingsText.RefusalOf"/> refuses is one KSP's format changes
    /// without an error. If KSP ever stops changing one, its case here fails,
    /// and the rule is refusing a value it no longer needs to.
    /// </summary>
    public class SettingsEncodingRoundTripTests : IDisposable
    {
        private readonly string _directory;
        private readonly string _path;

        public SettingsEncodingRoundTripTests()
        {
            _directory = Path.Combine(Path.GetTempPath(), "gonogo-encoding-" + Guid.NewGuid().ToString("N"));
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

        private string? ThroughAddValue(string text)
        {
            var root = new ConfigNode();
            root.AddNode("PANEL").AddValue("label", text);
            root.Save(_path);
            return ConfigNode.Load(_path)?.GetNode("PANEL")?.GetValue("label");
        }

        [Theory]
        [InlineData("ws://host:8090")]
        [InlineData("a{b")]
        [InlineData("a}b")]
        [InlineData("a\tb")]
        [InlineData(" leading")]
        [InlineData("trailing ")]
        [InlineData("a\nb")]
        public void EveryRefusedSpellingComesBackChanged(string text)
        {
            Assert.NotNull(SettingsText.RefusalOf(text));

            Assert.NotEqual(text, ThroughAddValue(text));
        }

        /// <summary>
        /// The path the encoding rule's newline case is really about. The
        /// store's own writer goes through <c>AddValue</c>, which strips a line
        /// break, but <c>SetValue</c> writes it literally, and the file that
        /// comes back no longer has the shape that was saved.
        /// </summary>
        [Fact]
        public void ANewlineThroughSetValueBreaksTheFilesShape()
        {
            var root = new ConfigNode();
            root.AddNode("PANEL").SetValue("label", "first\nsecond = injected", true);
            root.Save(_path);

            var panel = ConfigNode.Load(_path)?.GetNode("PANEL");

            Assert.NotNull(panel);
            Assert.NotEqual("first\nsecond = injected", panel!.GetValue("label"));
            Assert.Equal("injected", panel.GetValue("second"));
        }

        [Theory]
        [InlineData("a=b=c")]
        [InlineData("ws:")]
        [InlineData(@"C:\Games\KSP")]
        [InlineData(@"\\server\share")]
        public void WhatTheRuleAcceptsComesBackUnchanged(string text)
        {
            Assert.Null(SettingsText.RefusalOf(text));

            Assert.Equal(text, ThroughAddValue(text));
        }

        /// <summary>
        /// A document that reached the writer without going through
        /// <see cref="SettingsStore.Stage(string, string)"/> is refused whole,
        /// and the file on disk is left byte for byte as it was.
        /// </summary>
        [Fact]
        public void TheWriterRefusesADocumentThatWouldNotSurviveAndLeavesTheFile()
        {
            File.WriteAllText(_path, "SIGNAL_DELAY\n{\n\tenabled = True\n}\n");
            var before = File.ReadAllBytes(_path);
            var backing = new ConfigNodeSettingsStore(_path, _ => { });
            var document = backing.Read();
            document.Root.BlockOrAdd("PANEL").SetValue("endpoint", "ws://host:8090");

            var outcome = backing.Write(document);

            Assert.False(outcome.Success);
            Assert.StartsWith("PANEL/endpoint: ", outcome.Reason);
            Assert.Equal(before, File.ReadAllBytes(_path));
        }

        /// <summary>
        /// A hand-typed row with no name survives a save as itself, which is
        /// why the writer's check lets an empty name through.
        /// </summary>
        [Fact]
        public void AnEmptyNameInTheFileSurvivesASave()
        {
            File.WriteAllText(_path, "GHOST\n{\n\t= 5\n}\n");
            var store = new SettingsStore(new ConfigNodeSettingsStore(_path, _ => { }));
            store.Stage("SIGNAL_DELAY/enabled", true);

            var outcome = store.Commit();

            Assert.True(outcome.Success, outcome.Reason);
            Assert.Equal("5", ConfigNode.Load(_path)?.GetNode("GHOST")?.GetValue(string.Empty));
        }

        /// <summary>
        /// A tab typed into the file by hand reads as the space KSP's writer
        /// would turn it into, so the next save neither refuses nor quietly
        /// writes something the document did not say.
        /// </summary>
        [Fact]
        public void ATabTypedIntoTheFileDoesNotBlockASave()
        {
            File.WriteAllText(_path, "GHOST\n{\n\tnote = a\tb\n}\n");
            var store = new SettingsStore(new ConfigNodeSettingsStore(_path, _ => { }));

            Assert.Equal("a b", store.Text("GHOST/note"));
            store.Stage("SIGNAL_DELAY/enabled", true);
            var outcome = store.Commit();

            Assert.True(outcome.Success, outcome.Reason);
            Assert.Equal("a b", ConfigNode.Load(_path)?.GetNode("GHOST")?.GetValue("note"));
        }
    }
}
