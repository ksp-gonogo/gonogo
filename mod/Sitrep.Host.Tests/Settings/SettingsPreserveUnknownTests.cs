using System.Collections.Generic;
using Sitrep.Host.Settings;
using Xunit;

namespace Sitrep.Host.Tests.Settings
{
    /// <summary>
    /// A save is load-modify-save over the file, never a serialisation of what
    /// this launch declared. The block these tests call Ghost stands for any
    /// Uplink with no declarer this launch: uninstalled, refused on its contract
    /// major, or failed to start. A writer that rebuilt the file from
    /// declarations would delete its settings at the first SAVE press, and an
    /// empty settings panel would read as fine.
    /// </summary>
    public class SettingsPreserveUnknownTests
    {
        private const string Owned = "Uplinks/Rp1/upgradeSlipWarningDays";

        private static SettingsDocument FileWithAGhost()
        {
            var document = new SettingsDocument();
            var ghost = document.Root.BlockOrAdd("Uplinks").BlockOrAdd("Ghost");
            ghost.SetValue("someSetting", "12");
            ghost.SetValue("writtenBy", "0.2.0");
            document.Set(Owned, "30");
            return document;
        }

        /// <summary>What a save lost of the Ghost block, empty when nothing was.</summary>
        private static List<string> GhostLoss(SettingsDocument written)
        {
            var lost = new List<string>();
            if (written.Text("Uplinks/Ghost/someSetting") != "12")
            {
                lost.Add("someSetting");
            }

            if (written.Text("Uplinks/Ghost/writtenBy") != "0.2.0")
            {
                lost.Add("writtenBy");
            }

            return lost;
        }

        private static SettingsDocument SaveWithOnlyRp1Declared(ISettingsBackingStore backing)
        {
            var store = new SettingsStore(backing);
            store.Declare(SettingsRow.Number(Owned, 30));
            store.Stage(Owned, 45);
            store.Commit();
            return backing.Read();
        }

        [Fact]
        public void ABlockNothingDeclaredSurvivesASaveWhole()
        {
            var written = SaveWithOnlyRp1Declared(new InMemorySettingsStore(FileWithAGhost()));

            Assert.Empty(GhostLoss(written));
            Assert.Equal("45", written.Text(Owned));
        }

        /// <summary>
        /// The check above, run against the writer it exists to forbid. A
        /// preserve-unknown test that never saw a loss could be passing over a
        /// writer that was never exercised.
        /// </summary>
        [Fact]
        public void TheSameCheckSeesAWriterThatRebuildsFromDeclarations()
        {
            var written = SaveWithOnlyRp1Declared(
                new DeclaredOnlyWriter(new InMemorySettingsStore(FileWithAGhost()), Owned));

            Assert.Equal(new[] { "someSetting", "writtenBy" }, GhostLoss(written));
        }

        /// <summary>
        /// An operator edits the file while the game runs. The next save takes
        /// every row this launch does not own from the file as it now stands, so
        /// the edit is not overwritten from the copy read at boot.
        /// </summary>
        [Fact]
        public void AHandEditMadeMidSessionSurvivesTheNextSave()
        {
            var backing = new InMemorySettingsStore(FileWithAGhost());
            var store = new SettingsStore(backing);
            store.Declare(SettingsRow.Number(Owned, 30));

            var edited = backing.Read();
            edited.Set("Uplinks/Ghost/someSetting", "99");
            edited.Set("Uplinks/HandAdded/flag", "True");
            backing.EditElsewhere(edited);
            store.Stage(Owned, 45);
            store.Commit();

            var written = backing.Read();
            Assert.Equal("99", written.Text("Uplinks/Ghost/someSetting"));
            Assert.Equal("True", written.Text("Uplinks/HandAdded/flag"));
            Assert.Equal("45", written.Text(Owned));
        }

        /// <summary>
        /// Memory is the authority for a row this launch owns, so a hand edit to
        /// one is written over at the next save. Said here so it is a decision
        /// rather than a surprise.
        /// </summary>
        [Fact]
        public void AnOwnedRowEditedByHandIsWrittenBackFromMemory()
        {
            var backing = new InMemorySettingsStore(FileWithAGhost());
            var store = new SettingsStore(backing);
            store.Declare(SettingsRow.Number(Owned, 30));

            var edited = backing.Read();
            edited.Set(Owned, "7");
            backing.EditElsewhere(edited);
            store.Stage("SIGNAL_DELAY/enabled", true);
            store.Commit();

            Assert.Equal("30", backing.Read().Text(Owned));
        }

        /// <summary>
        /// An unowned row the operator removes by hand stays removed: the save
        /// takes that block from the file, and memory has no claim on it.
        /// </summary>
        [Fact]
        public void AnUnownedRowRemovedByHandStaysRemoved()
        {
            var backing = new InMemorySettingsStore(FileWithAGhost());
            var store = new SettingsStore(backing);
            store.Declare(SettingsRow.Number(Owned, 30));

            var edited = new SettingsDocument();
            edited.Set(Owned, "30");
            edited.Set("Uplinks/Ghost/writtenBy", "0.2.0");
            backing.EditElsewhere(edited);
            store.Stage(Owned, 45);
            store.Commit();

            var written = backing.Read();
            Assert.Null(written.Text("Uplinks/Ghost/someSetting"));
            Assert.Equal("0.2.0", written.Text("Uplinks/Ghost/writtenBy"));
        }

        /// <summary>
        /// A file emptied while the game runs says nothing about what the
        /// settings are. Taking it as the new content would delete every block
        /// at once, so the save keeps what memory holds.
        /// </summary>
        [Fact]
        public void AnEmptiedFileMidSessionDeletesNothing()
        {
            var backing = new InMemorySettingsStore(FileWithAGhost());
            var store = new SettingsStore(backing);
            store.Declare(SettingsRow.Number(Owned, 30));

            backing.EditElsewhere(new SettingsDocument());
            store.Stage(Owned, 45);
            store.Commit();

            Assert.Empty(GhostLoss(backing.Read()));
        }

        /// <summary>
        /// A repeated value name is how the format spells a list, and a repeated
        /// block is someone's data. Both go back out as they came in, and a read
        /// resolves to the first, as KSP's own reader does.
        /// </summary>
        [Fact]
        public void RepeatedNamesAreCarriedThroughNotCollapsed()
        {
            var seed = new SettingsDocument();
            var list = seed.Root.BlockOrAdd("LIST");
            list.AppendValue("item", "a");
            list.AppendValue("item", "b");
            seed.Root.AppendBlock("TWICE").SetValue("x", "first");
            seed.Root.AppendBlock("TWICE").SetValue("x", "second");
            var backing = new InMemorySettingsStore(seed);
            var store = new SettingsStore(backing);

            store.Stage("SIGNAL_DELAY/enabled", true);
            store.Commit();

            var written = backing.Read();
            Assert.Equal(new[] { "a", "b" }, ValuesNamed(written.Root.Block("LIST")!, "item"));
            Assert.Equal(2, BlocksNamed(written.Root, "TWICE"));
            Assert.Equal("first", written.Text("TWICE/x"));
        }

        private static List<string> ValuesNamed(SettingsBlock block, string name)
        {
            var found = new List<string>();
            foreach (var entry in block.Values)
            {
                if (entry.Name == name)
                {
                    found.Add(entry.Text);
                }
            }

            return found;
        }

        private static int BlocksNamed(SettingsBlock block, string name)
        {
            var count = 0;
            foreach (var child in block.Blocks)
            {
                if (child.Name == name)
                {
                    count++;
                }
            }

            return count;
        }

        /// <summary>
        /// The writer the preserve-unknown rule forbids: it persists only the
        /// rows it was told are declared and drops everything else.
        /// </summary>
        private sealed class DeclaredOnlyWriter : ISettingsBackingStore
        {
            private readonly InMemorySettingsStore _inner;
            private readonly string[] _declared;

            internal DeclaredOnlyWriter(InMemorySettingsStore inner, params string[] declared)
            {
                _inner = inner;
                _declared = declared;
            }

            public string Path => _inner.Path;

            public SettingsReadSource LastReadFrom => _inner.LastReadFrom;

            public SettingsDocument Read() => _inner.Read();

            public SettingsDocument? ReadIfChangedElsewhere() => _inner.ReadIfChangedElsewhere();

            public WriteOutcome Write(SettingsDocument document)
            {
                var rebuilt = new SettingsDocument();
                foreach (var path in _declared)
                {
                    var text = document.Text(path);
                    if (text != null)
                    {
                        rebuilt.Set(path, text);
                    }
                }

                return _inner.Write(rebuilt);
            }
        }
    }
}
