using System;

namespace Sitrep.Host.Settings
{
    /// <summary>Which copy of the settings file a launch read its document from.</summary>
    public enum SettingsReadSource
    {
        /// <summary>The settings file itself.</summary>
        File = 0,

        /// <summary>
        /// The settings file was missing, empty or unreadable, and the backup
        /// the previous save left was read instead. The operator needs to know:
        /// whatever was saved after that backup is gone.
        /// </summary>
        Backup = 1,

        /// <summary>No settings file and no backup exist: a first run, and every setting is at its default.</summary>
        NoFile = 2,

        /// <summary>A settings file exists but neither it nor a backup could be read, so every setting is at its default.</summary>
        Unreadable = 3,
    }

    /// <summary>
    /// The file operations <see cref="AtomicSettingsFile"/> sequences, so the
    /// sequence is exercised without a disk and without KSP, and so a test can
    /// stop it after any one of them.
    /// </summary>
    public interface ISettingsFileSystem
    {
        bool Exists(string path);

        /// <summary>The file's bytes, or null when it is absent or cannot be read.</summary>
        byte[]? Bytes(string path);

        /// <summary>The document a file holds, or null when it is absent or cannot be parsed.</summary>
        SettingsDocument? ReadDocument(string path);

        /// <summary>Write <paramref name="document"/> as the whole of <paramref name="path"/>, creating its directory when needed.</summary>
        void WriteDocument(string path, SettingsDocument document);

        /// <summary>Copy a file over another, replacing it.</summary>
        void Copy(string source, string destination);

        /// <summary>
        /// Replace <paramref name="destination"/> with <paramref name="source"/>
        /// in one step. May throw <see cref="NotSupportedException"/>,
        /// <see cref="PlatformNotSupportedException"/> or an
        /// <see cref="System.IO.IOException"/> where the platform has no such
        /// step.
        /// </summary>
        void Replace(string source, string destination);

        /// <summary>Rename <paramref name="source"/> to <paramref name="destination"/>, which must not exist.</summary>
        void Move(string source, string destination);

        void Delete(string path);
    }

    /// <summary>
    /// The settings file, written so that no crash leaves it half-written and a
    /// damaged one is recovered from rather than read as a first run.
    ///
    /// <para><b>A write</b> puts the document into <c>&lt;path&gt;.new</c>,
    /// reads that back and compares it with what was meant, copies the current
    /// file to <c>&lt;path&gt;.bak</c>, and only then replaces the file. The
    /// file itself is never opened for writing, so at every moment it is either
    /// the previous complete document or the new one. The read-back is there
    /// because the format changes some values without an error; a rename proves
    /// a complete file landed, not that it says what was meant.</para>
    ///
    /// <para><b>A read</b> falls back to the backup when the file is missing,
    /// empty or unreadable, and says so through <see cref="LastReadFrom"/>. That
    /// half is what makes the write's care worth anything: a truncated file
    /// otherwise reads exactly like no file, and every setting silently reverts
    /// to its default.</para>
    ///
    /// <para><b><c>.new</c> is never read.</b> A complete one and one torn by a
    /// crash look the same, and every point in the sequence where the file is
    /// missing already has a backup beside it. The one exception is the very
    /// first save, where a crash costs that save and nothing else.</para>
    ///
    /// <para><b>A file that does not read is never copied over the
    /// backup.</b> After a launch that recovered from the backup, the next save
    /// would otherwise replace the only good copy with the damaged one before
    /// the new file was in place.</para>
    ///
    /// <para><b>What is proved, and what is not.</b> The tests stop the
    /// sequence after each of its file operations, and tear the
    /// <c>.new</c> write part way, and show that the next launch reads either
    /// the old document or the new one every time. That is a proof about the
    /// SEQUENCE. It rests on the platform's rename being atomic, which this code
    /// cannot check; it does not survive a power cut inside the operating
    /// system's write-back window, since net472 has no way to flush a directory;
    /// it does not arbitrate two processes writing at once; and it does not
    /// recover a backup torn by a crash during its own copy if the file is then
    /// also damaged before the next save.</para>
    /// </summary>
    public sealed class AtomicSettingsFile : ISettingsBackingStore
    {
        private readonly ISettingsFileSystem _files;
        private readonly Action<string> _warn;
        private byte[]? _lastSeen;

        public AtomicSettingsFile(string path, ISettingsFileSystem files, Action<string>? warn = null)
        {
            Path = path ?? throw new ArgumentNullException(nameof(path));
            _files = files ?? throw new ArgumentNullException(nameof(files));
            _warn = warn ?? (_ => { });
        }

        public string Path { get; }

        public string PendingPath => Path + ".new";

        public string BackupPath => Path + ".bak";

        /// <summary>Which copy the last <see cref="Read"/> used.</summary>
        public SettingsReadSource LastReadFrom { get; private set; } = SettingsReadSource.NoFile;

        public SettingsDocument Read()
        {
            _lastSeen = Safely(() => _files.Bytes(Path));
            var primary = Usable(Path);
            if (primary != null)
            {
                LastReadFrom = SettingsReadSource.File;
                return primary;
            }

            var backup = Usable(BackupPath);
            if (backup != null)
            {
                LastReadFrom = SettingsReadSource.Backup;
                Warn(Path + " is missing, empty or unreadable. Read the backup " + BackupPath
                    + " instead, so any setting saved after that backup was taken is lost.");
                return backup;
            }

            var exists = Safely(() => _files.Exists(Path));
            LastReadFrom = exists ? SettingsReadSource.Unreadable : SettingsReadSource.NoFile;
            if (exists)
            {
                Warn(Path + " cannot be read and no usable backup exists, so every setting starts at its default.");
            }

            return new SettingsDocument();
        }

        public SettingsDocument? ReadIfChangedElsewhere()
        {
            var now = Safely(() => _files.Bytes(Path));
            if (now == null || SameBytes(now, _lastSeen))
            {
                return null;
            }

            var document = Read();
            return LastReadFrom == SettingsReadSource.File ? document : null;
        }

        public WriteOutcome Write(SettingsDocument document)
        {
            if (document == null)
            {
                return WriteOutcome.Failed(Path, "no document given");
            }

            var violation = document.FirstEncodingViolation();
            if (violation != null)
            {
                return Refuse("did not write " + Path + ": " + violation);
            }

            try
            {
                _files.WriteDocument(PendingPath, document);

                var landed = _files.ReadDocument(PendingPath);
                var difference = landed == null
                    ? "the written file could not be read back"
                    : document.FirstDifferenceFrom(landed);
                if (difference != null)
                {
                    TryDelete(PendingPath);
                    return Refuse("did not replace " + Path
                        + ", because the file written would not have said what was meant (" + difference + ")");
                }

                if (Usable(Path) != null)
                {
                    _files.Copy(Path, BackupPath);
                }

                Install();
                _lastSeen = Safely(() => _files.Bytes(Path));
                return WriteOutcome.Written(Path);
            }
            catch (Exception ex)
            {
                return Refuse("could not persist " + Path
                    + ", the settings stay in force for this session only: " + ex.Message);
            }
        }

        /// <summary>
        /// Put the verified pending file in place. A one-step replace where the
        /// platform has one; otherwise the old file is removed and the pending
        /// one renamed, and the backup taken just before covers the moment in
        /// between.
        /// </summary>
        private void Install()
        {
            if (!_files.Exists(Path))
            {
                _files.Move(PendingPath, Path);
                return;
            }

            try
            {
                _files.Replace(PendingPath, Path);
            }
            catch (Exception ex) when (ex is NotSupportedException || ex is System.IO.IOException)
            {
                _files.Delete(Path);
                _files.Move(PendingPath, Path);
            }
        }

        private SettingsDocument? Usable(string path)
        {
            var document = Safely(() => _files.ReadDocument(path));
            return document == null || document.IsEmpty ? null : document;
        }

        private WriteOutcome Refuse(string reason)
        {
            Warn(reason);
            return WriteOutcome.Failed(Path, reason);
        }

        private void TryDelete(string path)
        {
            try
            {
                _files.Delete(path);
            }
            catch (Exception)
            {
                // A stray pending file is never read, so failing to remove one
                // costs a few hundred bytes and nothing else.
            }
        }

        private void Warn(string message)
        {
            try
            {
                _warn(message);
            }
            catch (Exception)
            {
                // Never take down a settings change over a failed log message.
            }
        }

        private static T Safely<T>(Func<T> read)
        {
            try
            {
                return read();
            }
            catch (Exception)
            {
                return default!;
            }
        }

        private static bool SameBytes(byte[] a, byte[]? b)
        {
            if (b == null || a.Length != b.Length)
            {
                return false;
            }

            for (var i = 0; i < a.Length; i++)
            {
                if (a[i] != b[i])
                {
                    return false;
                }
            }

            return true;
        }
    }
}
