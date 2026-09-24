using System;
using System.Collections.Generic;
using System.Text;
using Sitrep.Host.Settings;
using Xunit;

namespace Sitrep.Host.Tests.Settings
{
    /// <summary>
    /// A crash at any point in a save leaves a file the next launch reads as
    /// either the previous settings or the new ones.
    ///
    /// <para>The proof is about the SEQUENCE, and it is exhaustive over it:
    /// <see cref="DyingFiles"/> stops dead after its Nth file operation, with
    /// nothing after that point changing anything, which is what a process
    /// death does and a thrown exception with a catch after it does not. Every
    /// N is tried, from three starting states and with both ways of putting the
    /// new file in place. What it cannot reach is written on
    /// <see cref="AtomicSettingsFile"/> itself.</para>
    /// </summary>
    public class AtomicSettingsFileTests
    {
        private const string FilePath = "PluginData/gonogo.cfg";

        private static SettingsDocument Old()
        {
            var document = new SettingsDocument();
            document.Set("SIGNAL_DELAY/enabled", "True");
            document.Set("SIGNAL_DELAY/lightSpeedScale", "1");
            document.Set("Uplinks/Ghost/someSetting", "12");
            return document;
        }

        private static SettingsDocument New()
        {
            var document = Old();
            document.Set("SIGNAL_DELAY/lightSpeedScale", "0.1");
            document.Set("RECORDING/enabled", "True");
            return document;
        }

        public enum Start
        {
            FirstSave,
            GoodFile,
            DamagedFileWithGoodBackup,
        }

        private static DyingFiles StartingFrom(Start start, bool replaceSupported)
        {
            var files = new DyingFiles(replaceSupported);
            switch (start)
            {
                case Start.GoodFile:
                    files.Put(FilePath, Old());
                    break;
                case Start.DamagedFileWithGoodBackup:
                    files.PutRaw(FilePath, string.Empty);
                    files.Put(FilePath + ".bak", Old());
                    break;
            }

            return files;
        }

        /// <summary>
        /// Every crash point, and for each the document the next launch reads.
        /// Returns what went wrong, empty when every crash left the old
        /// document or the new one.
        /// </summary>
        private static List<string> Sweep(
            Start start,
            bool replaceSupported,
            bool tear,
            Func<ISettingsFileSystem, ISettingsBackingStore> open,
            out int oldSeen,
            out int newSeen)
        {
            var problems = new List<string>();
            oldSeen = 0;
            newSeen = 0;
            var before = start == Start.FirstSave ? new SettingsDocument() : Old();

            var clean = StartingFrom(start, replaceSupported);
            open(clean).Read();
            open(clean).Write(New());
            var operations = clean.Mutations;

            for (var crashAfter = 0; crashAfter <= operations; crashAfter++)
            {
                var files = StartingFrom(start, replaceSupported);
                var store = open(files);
                store.Read();
                files.DieAfter(crashAfter, tear);
                store.Write(New());
                files.Revive();

                var nextLaunch = open(files).Read();
                if (nextLaunch.FirstDifferenceFrom(before) == null)
                {
                    oldSeen++;
                }
                else if (nextLaunch.FirstDifferenceFrom(New()) == null)
                {
                    newSeen++;
                }
                else
                {
                    problems.Add("crash after operation " + crashAfter + (tear ? " (torn)" : string.Empty)
                        + " left neither: " + nextLaunch.FirstDifferenceFrom(New()));
                }
            }

            return problems;
        }

        private static ISettingsBackingStore Atomic(ISettingsFileSystem files) => new AtomicSettingsFile(FilePath, files);

        [Theory]
        [InlineData(Start.FirstSave, true, false)]
        [InlineData(Start.FirstSave, false, false)]
        [InlineData(Start.FirstSave, true, true)]
        [InlineData(Start.GoodFile, true, false)]
        [InlineData(Start.GoodFile, false, false)]
        [InlineData(Start.GoodFile, true, true)]
        [InlineData(Start.GoodFile, false, true)]
        [InlineData(Start.DamagedFileWithGoodBackup, true, false)]
        [InlineData(Start.DamagedFileWithGoodBackup, false, false)]
        [InlineData(Start.DamagedFileWithGoodBackup, false, true)]
        public void NoCrashPointLeavesAnythingButTheOldSettingsOrTheNew(Start start, bool replaceSupported, bool tear)
        {
            var problems = Sweep(start, replaceSupported, tear, Atomic, out var oldSeen, out var newSeen);

            Assert.Empty(problems);
            // Not vacuous: the sweep reached both sides of the moment the new
            // file goes in, so it crossed every step in between.
            Assert.True(oldSeen > 0, "no crash point left the old settings");
            Assert.True(newSeen > 0, "no crash point left the new settings");
        }

        /// <summary>
        /// The sweep run against the writer it exists to forbid, one that
        /// writes the file in place. A crash torn through that write is seen,
        /// so a green sweep above is a finding and not an instrument that could
        /// not see one.
        /// </summary>
        [Fact]
        public void TheSweepSeesAWriterThatWritesTheFileInPlace()
        {
            var problems = Sweep(Start.GoodFile, true, true, files => new InPlaceFile(files), out _, out _);

            Assert.NotEmpty(problems);
        }

        [Fact]
        public void ADamagedFileIsReadFromItsBackupAndSaysSo()
        {
            var files = StartingFrom(Start.DamagedFileWithGoodBackup, true);
            var warned = new List<string>();
            var file = new AtomicSettingsFile(FilePath, files, warned.Add);

            var read = file.Read();

            Assert.Null(read.FirstDifferenceFrom(Old()));
            Assert.Equal(SettingsReadSource.Backup, file.LastReadFrom);
            Assert.Contains(warned, line => line.Contains(".bak"));
        }

        [Fact]
        public void NoFileAndNoBackupIsAFirstRunNotADamagedOne()
        {
            var file = new AtomicSettingsFile(FilePath, new DyingFiles(true));

            Assert.True(file.Read().IsEmpty);
            Assert.Equal(SettingsReadSource.NoFile, file.LastReadFrom);
        }

        [Fact]
        public void ADamagedFileWithNoBackupSaysItCouldNotBeRead()
        {
            var files = new DyingFiles(true);
            files.PutRaw(FilePath, string.Empty);
            var file = new AtomicSettingsFile(FilePath, files);

            Assert.True(file.Read().IsEmpty);
            Assert.Equal(SettingsReadSource.Unreadable, file.LastReadFrom);
        }

        /// <summary>
        /// The trap after a recovery: the file is damaged and the backup is the
        /// only good copy. A save must not copy the damaged file over it.
        /// </summary>
        [Fact]
        public void ASaveAfterARecoveryKeepsTheGoodBackup()
        {
            var files = StartingFrom(Start.DamagedFileWithGoodBackup, true);
            var file = new AtomicSettingsFile(FilePath, files);
            file.Read();

            Assert.True(file.Write(New()).Success);

            Assert.Null(files.Get(FilePath + ".bak")!.FirstDifferenceFrom(Old()));
            Assert.Null(files.Get(FilePath)!.FirstDifferenceFrom(New()));
        }

        /// <summary>
        /// The read-back that makes the write more than a rename. A format that
        /// changes a value without an error is caught before the file is
        /// replaced, and the previous file is untouched.
        /// </summary>
        [Fact]
        public void AWriteThatWouldNotSayWhatWasMeantLeavesThePreviousFile()
        {
            var files = StartingFrom(Start.GoodFile, true);
            files.MangleOnWrite = "0.1";
            var file = new AtomicSettingsFile(FilePath, files);
            file.Read();
            var before = files.Raw(FilePath);

            var outcome = file.Write(New());

            Assert.False(outcome.Success);
            Assert.Contains("lightSpeedScale", outcome.Reason);
            Assert.Equal(before, files.Raw(FilePath));
            Assert.False(files.Exists(FilePath + ".new"));
        }

        /// <summary>
        /// Where the platform has no one-step replace, the old file is removed
        /// and the new one renamed; the write still lands.
        /// </summary>
        [Fact]
        public void WithoutAOneStepReplaceTheWriteStillLands()
        {
            var files = StartingFrom(Start.GoodFile, replaceSupported: false);
            var file = new AtomicSettingsFile(FilePath, files);
            file.Read();

            Assert.True(file.Write(New()).Success);

            Assert.Null(files.Get(FilePath)!.FirstDifferenceFrom(New()));
            Assert.Null(files.Get(FilePath + ".bak")!.FirstDifferenceFrom(Old()));
        }

        /// <summary>The forbidden writer: straight into the file, with no copy aside.</summary>
        private sealed class InPlaceFile : ISettingsBackingStore
        {
            private readonly ISettingsFileSystem _files;

            internal InPlaceFile(ISettingsFileSystem files)
            {
                _files = files;
            }

            public string Path => FilePath;

            public SettingsReadSource LastReadFrom => SettingsReadSource.File;

            public SettingsDocument Read() => _files.ReadDocument(FilePath) ?? new SettingsDocument();

            public SettingsDocument? ReadIfChangedElsewhere() => null;

            public WriteOutcome Write(SettingsDocument document)
            {
                try
                {
                    _files.WriteDocument(FilePath, document);
                    return WriteOutcome.Written(FilePath);
                }
                catch (Exception ex)
                {
                    return WriteOutcome.Failed(FilePath, ex.Message);
                }
            }
        }

        /// <summary>
        /// Files in memory that can stop dead after a chosen number of
        /// operations that change them. After that point every operation throws
        /// and none changes anything, until <see cref="Revive"/> starts the next
        /// launch. With a tear, the operation that dies is a document write,
        /// and it leaves the first half of what it would have written.
        ///
        /// <para>The text format is this file's own: one line per entry, which
        /// a torn write cuts part way like any other.</para>
        /// </summary>
        private sealed class DyingFiles : ISettingsFileSystem
        {
            private readonly Dictionary<string, string> _files = new Dictionary<string, string>(StringComparer.Ordinal);
            private readonly bool _replaceSupported;
            private int? _dieAfter;
            private bool _tear;
            private bool _dead;

            internal DyingFiles(bool replaceSupported)
            {
                _replaceSupported = replaceSupported;
            }

            internal int Mutations { get; private set; }

            /// <summary>A value that a write turns into something else, as KSP's format does to a brace.</summary>
            internal string? MangleOnWrite { get; set; }

            internal void DieAfter(int operations, bool tear)
            {
                Mutations = 0;
                _dieAfter = operations;
                _tear = tear;
            }

            internal void Revive()
            {
                _dieAfter = null;
                _dead = false;
            }

            internal void Put(string path, SettingsDocument document) => _files[path] = Serialise(document);

            internal void PutRaw(string path, string text) => _files[path] = text;

            internal string? Raw(string path) => _files.TryGetValue(path, out var text) ? text : null;

            internal SettingsDocument? Get(string path) => ReadDocument(path);

            public bool Exists(string path)
            {
                Alive();
                return _files.ContainsKey(path);
            }

            public byte[]? Bytes(string path)
            {
                Alive();
                return _files.TryGetValue(path, out var text) ? Encoding.UTF8.GetBytes(text) : null;
            }

            public SettingsDocument? ReadDocument(string path)
            {
                Alive();
                return _files.TryGetValue(path, out var text) ? Parse(text) : null;
            }

            public void WriteDocument(string path, SettingsDocument document)
            {
                var text = Serialise(document);
                if (MangleOnWrite != null)
                {
                    text = text.Replace("=" + MangleOnWrite + "\n", "=" + MangleOnWrite + "0\n");
                }

                if (Dies() && _tear)
                {
                    _files[path] = text.Substring(0, text.Length / 2);
                }

                Proceed();
                _files[path] = text;
            }

            public void Copy(string source, string destination)
            {
                Dies();
                Proceed();
                _files[destination] = _files[source];
            }

            public void Replace(string source, string destination)
            {
                if (!_replaceSupported)
                {
                    throw new PlatformNotSupportedException("no one-step replace here");
                }

                Dies();
                Proceed();
                _files[destination] = _files[source];
                _files.Remove(source);
            }

            public void Move(string source, string destination)
            {
                Dies();
                Proceed();
                if (_files.ContainsKey(destination))
                {
                    throw new System.IO.IOException(destination + " exists");
                }

                _files[destination] = _files[source];
                _files.Remove(source);
            }

            public void Delete(string path)
            {
                Dies();
                Proceed();
                _files.Remove(path);
            }

            /// <summary>Whether the operation about to run is the one the process dies in.</summary>
            private bool Dies()
            {
                Alive();
                if (_dieAfter.HasValue && Mutations >= _dieAfter.Value)
                {
                    _dead = true;
                    return true;
                }

                return false;
            }

            private void Proceed()
            {
                Alive();
                Mutations++;
            }

            private void Alive()
            {
                if (_dead)
                {
                    throw new InvalidOperationException("the process died here");
                }
            }

            private static string Serialise(SettingsDocument document)
            {
                var text = new StringBuilder();
                Serialise(document.Root, text);
                return text.ToString();
            }

            private static void Serialise(SettingsBlock block, StringBuilder text)
            {
                foreach (var entry in block.Values)
                {
                    text.Append("v ").Append(entry.Name).Append('=').Append(entry.Text).Append('\n');
                }

                foreach (var child in block.Blocks)
                {
                    text.Append("b ").Append(child.Name).Append('\n');
                    Serialise(child, text);
                    text.Append("e\n");
                }
            }

            /// <summary>Lenient on purpose: a torn file reads as whatever part of it survived, as KSP's reader does.</summary>
            private static SettingsDocument Parse(string text)
            {
                var document = new SettingsDocument();
                var stack = new Stack<SettingsBlock>();
                stack.Push(document.Root);
                foreach (var line in text.Split('\n'))
                {
                    if (line.StartsWith("v ", StringComparison.Ordinal))
                    {
                        var body = line.Substring(2);
                        var equals = body.IndexOf('=');
                        if (equals > 0)
                        {
                            stack.Peek().AppendValue(body.Substring(0, equals), body.Substring(equals + 1));
                        }
                    }
                    else if (line.StartsWith("b ", StringComparison.Ordinal))
                    {
                        stack.Push(stack.Peek().AppendBlock(line.Substring(2)));
                    }
                    else if (line == "e" && stack.Count > 1)
                    {
                        stack.Pop();
                    }
                }

                return document;
            }
        }
    }
}
