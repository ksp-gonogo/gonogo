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
    /// <para><b>Nothing re-reads after that.</b> The in-memory document is the
    /// authority for the process lifetime. A file edited while the game runs is
    /// not honoured; every consumer would otherwise have to tolerate a setting
    /// changing under it at an arbitrary frame.</para>
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

        public SettingsStore(ISettingsBackingStore backing)
        {
            _backing = backing ?? throw new ArgumentNullException(nameof(backing));
            Document = _backing.Read() ?? new SettingsDocument();
        }

        public SettingsDocument Document { get; }

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
            if (!Document.Has(row.Path))
            {
                Document.Set(row.Path, row.DefaultText);
            }
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
        /// against the declared row. An undeclared path takes the text as it
        /// stands.
        /// </summary>
        public void Stage(string path, string text)
        {
            SettingsDocument.Split(path);
            if (text == null)
            {
                throw new ArgumentNullException(nameof(text));
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
            var changed = new List<string>();
            foreach (var staged in _staged)
            {
                if (!string.Equals(Document.Text(staged.Key), staged.Value, StringComparison.Ordinal))
                {
                    Document.Set(staged.Key, staged.Value);
                    changed.Add(staged.Key);
                }
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
