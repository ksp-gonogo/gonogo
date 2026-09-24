using System;
using System.Collections.Generic;

namespace Sitrep.Host.Settings
{
    /// <summary>
    /// The settings document and everything that may change it. Persisting is a
    /// side effect of mutating the document, not a second code path a caller
    /// has to remember to take.
    ///
    /// <para><b>Reading happens once, at construction.</b> Build the store
    /// before any Uplink registers, so a declarer can seed a default into a row
    /// the file did not contain and then read its effective value while it
    /// registers.</para>
    ///
    /// <para><b>Nothing re-reads for its values after that.</b> The in-memory
    /// document is the authority for every row this store OWNS, meaning one
    /// declared or committed this session, for the process lifetime; every
    /// consumer would otherwise have to tolerate a setting changing under it at
    /// an arbitrary frame.</para>
    ///
    /// <para><b>Every other row is preserved, never rewritten from a
    /// model.</b> A save is load-modify-save over the whole document read from
    /// the file, so a block whose declarer did not run this launch (an Uplink
    /// that is uninstalled, refused, or failed to start) goes back to disk as it
    /// came off it. When the file has been changed elsewhere since this store
    /// last touched it, a commit takes every row it does not own from the file
    /// as it now stands, so a hand edit made while the game runs survives the
    /// next save instead of being overwritten from memory.</para>
    ///
    /// <para><b>Nothing is ever deleted as a side effect.</b> A row whose
    /// declaration a later version drops stays in the file as an unowned row,
    /// for good; removing one is an explicit act, not something a save infers
    /// from a declaration that is missing. An unowned row the operator deletes
    /// by hand stays deleted. An OWNED row deleted by hand is written back at
    /// the next save, since memory is its authority.</para>
    ///
    /// <para><b>A failed persist is not a failed change.</b> <see cref="Commit"/>
    /// applies to the document first and reports what became of the write, so a
    /// read-only GameData costs the operator the value at the next launch and
    /// nothing at this one.</para>
    /// </summary>
    public sealed class SettingsStore
    {
        private sealed class Watch : IDisposable
        {
            private readonly SettingsStore _store;

            internal Watch(SettingsStore store, string path, Action<SettingsDocument> callback)
            {
                _store = store;
                Path = path;
                Callback = callback;
            }

            internal string Path { get; }

            internal Action<SettingsDocument> Callback { get; }

            public void Dispose() => _store._watches.Remove(this);
        }

        private readonly ISettingsBackingStore _backing;
        private readonly Dictionary<string, SettingsRow> _rows =
            new Dictionary<string, SettingsRow>(StringComparer.Ordinal);
        private readonly Dictionary<string, string> _staged =
            new Dictionary<string, string>(StringComparer.Ordinal);
        private readonly List<Watch> _watches = new List<Watch>();
        private readonly HashSet<string> _owned = new HashSet<string>(StringComparer.Ordinal);

        public SettingsStore(ISettingsBackingStore backing)
        {
            _backing = backing ?? throw new ArgumentNullException(nameof(backing));
            Document = _backing.Read() ?? new SettingsDocument();
            LoadedFrom = _backing.LastReadFrom;
        }

        public SettingsDocument Document { get; private set; }

        /// <summary>Which copy of the file this launch's document came from: the file, its backup, or neither.</summary>
        public SettingsReadSource LoadedFrom { get; }

        /// <summary>Where the document persists, for reporting to an operator.</summary>
        public string Path => _backing.Path;

        /// <summary>What became of the last <see cref="Commit"/>.</summary>
        public WriteOutcome LastWrite { get; private set; } = WriteOutcome.NotAttempted;

        /// <summary>
        /// Where a change callback's throw goes. Without a sink it is swallowed:
        /// one consumer's failure must not abandon the rest of them mid-notify,
        /// and must not take down the command that is already in force.
        /// </summary>
        public Action<string>? DiagnosticLog { get; set; }

        /// <summary>
        /// Declare a row and seed its default if the document does not already
        /// carry one. Seeding does NOT persist: a launch that only read the file
        /// leaves it exactly as it found it.
        /// </summary>
        public void Declare(SettingsRow row)
        {
            if (row == null)
            {
                throw new ArgumentNullException(nameof(row));
            }

            _rows[row.Path] = row;
            _owned.Add(row.Path);
            if (!Document.Has(row.Path))
            {
                Document.Set(row.Path, row.DefaultText);
            }
        }

        /// <summary>
        /// Put a value into the document as a row this store owns, without
        /// persisting it or telling a watcher: it reaches the file with the next
        /// <see cref="Commit"/>. For a value decided at start-up rather than by
        /// the operator, such as a migration or the version stamped beside a
        /// block.
        /// </summary>
        public void Seed(string path, string text)
        {
            SettingsDocument.Split(path);
            var refusal = SettingsText.RefusalOf(text);
            if (refusal != null)
            {
                throw new ArgumentException(path + ": " + refusal, nameof(text));
            }

            _owned.Add(path);
            Document.Set(path, text);
        }

        public string? Text(string path) => Document.Text(path);

        /// <summary>The boolean at <paramref name="path"/>, falling back to the declared default when the row is absent or unparseable.</summary>
        public bool Bool(string path) =>
            SettingsText.ToBool(Document.Text(path)) ?? SettingsText.ToBool(DefaultTextAt(path)) ?? false;

        /// <summary>The number at <paramref name="path"/>, falling back to the declared default when the row is absent or unparseable.</summary>
        public double Number(string path) =>
            SettingsText.ToNumber(Document.Text(path)) ?? SettingsText.ToNumber(DefaultTextAt(path)) ?? 0.0;

        /// <summary>
        /// Watch a row, or a whole block, for the lifetime of the returned
        /// handle. The callback fires IMMEDIATELY with the document as it
        /// stands, which is what makes this a replacement for reading the file
        /// once at boot rather than an addition to it.
        /// </summary>
        public IDisposable OnChanged(string path, Action<SettingsDocument> callback)
        {
            if (callback == null)
            {
                throw new ArgumentNullException(nameof(callback));
            }

            SettingsDocument.Split(path);
            var watch = new Watch(this, path, callback);
            _watches.Add(watch);
            Invoke(watch);
            return watch;
        }

        /// <summary>
        /// Stage a value for the next <see cref="Commit"/>, after checking it
        /// against the encoding every value obeys and against the declared row.
        /// An undeclared path is held to the encoding and takes the text
        /// otherwise as it stands. A refusal is an
        /// <see cref="ArgumentException"/> whose message is the reason, fit to
        /// show an operator.
        /// </summary>
        public void Stage(string path, string text)
        {
            SettingsDocument.Split(path);
            if (text == null)
            {
                throw new ArgumentNullException(nameof(text));
            }

            var refusal = SettingsText.RefusalOf(text);
            if (refusal != null)
            {
                throw new ArgumentException(path + ": " + refusal, nameof(text));
            }

            if (_rows.TryGetValue(path, out var row) && !row.Accepts(text))
            {
                throw new ArgumentException(
                    path + " holds a " + row.Kind + " value, not " + text, nameof(text));
            }

            _staged[path] = text;
        }

        public void Stage(string path, bool value) => Stage(path, SettingsText.FromBool(value));

        public void Stage(string path, double value) => Stage(path, SettingsText.FromNumber(value));

        /// <summary>
        /// The SAVE press: apply everything staged, persist the whole document
        /// once, then tell the watchers. One file write per press rather than
        /// one per row.
        /// </summary>
        public WriteOutcome Commit()
        {
            var elsewhere = _backing.ReadIfChangedElsewhere();
            if (elsewhere != null)
            {
                Document = TakeUnownedRowsFrom(elsewhere);
            }

            var changed = new List<string>();
            foreach (var staged in _staged)
            {
                if (!string.Equals(Document.Text(staged.Key), staged.Value, StringComparison.Ordinal))
                {
                    Document.Set(staged.Key, staged.Value);
                    changed.Add(staged.Key);
                }
            }

            foreach (var path in _staged.Keys)
            {
                _owned.Add(path);
            }

            _staged.Clear();
            LastWrite = _backing.Write(Document) ?? WriteOutcome.Failed(Path, "the backing store reported nothing");

            // After the write, so a watcher that reports on persistence reads
            // an outcome that is already true.
            for (var i = _watches.Count - 1; i >= 0; i--)
            {
                var watch = _watches[i];
                for (var j = 0; j < changed.Count; j++)
                {
                    if (SettingsDocument.IsUnder(changed[j], watch.Path))
                    {
                        Invoke(watch);
                        break;
                    }
                }
            }

            return LastWrite;
        }

        /// <summary>
        /// The file as it now stands, with every row this store owns put back
        /// to what memory holds for it.
        /// </summary>
        private SettingsDocument TakeUnownedRowsFrom(SettingsDocument onDisk)
        {
            var merged = onDisk.Copy();
            foreach (var path in _owned)
            {
                var text = Document.Text(path);
                if (text != null)
                {
                    merged.Set(path, text);
                }
            }

            return merged;
        }

        private string DefaultTextAt(string path) =>
            _rows.TryGetValue(path, out var row) ? row.DefaultText : string.Empty;

        private void Invoke(Watch watch)
        {
            try
            {
                watch.Callback(Document);
            }
            catch (Exception ex)
            {
                try
                {
                    DiagnosticLog?.Invoke(
                        "a settings watcher on " + watch.Path + " threw and was ignored: " + ex.Message);
                }
                catch (Exception)
                {
                    // The sink is a live-process facility and this type runs
                    // headlessly too. Saying nothing beats taking down a
                    // settings change that is already in force.
                }
            }
        }
    }
}
