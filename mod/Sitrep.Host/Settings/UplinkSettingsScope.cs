using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Settings
{
    /// <summary>
    /// One Uplink's block of the settings document, <c>Uplinks/&lt;id&gt;</c>,
    /// as the Uplink sees it.
    ///
    /// <para><b>Nothing reaches the store until the declarer returns.</b>
    /// Declarations, migrations and change subscriptions made inside
    /// <see cref="IUplinkSettingsDeclarer.DeclareSettings"/> are held here and
    /// applied together by <see cref="Apply"/>. A declarer that throws part way
    /// therefore changes nothing: no default is seeded, no version is stamped,
    /// and the stored block goes back to disk at the next save exactly as it
    /// came off it. The handle then answers reads with the defaults it was told
    /// before the throw, and never with a stored value no declaration
    /// vouched for.</para>
    /// </summary>
    public sealed class UplinkSettingsScope : IUplinkSettings
    {
        /// <summary>The row beside every block naming the Uplink version that last saved it.</summary>
        public const string WrittenByName = UplinkSettingRow.WrittenByName;

        private readonly SettingsStore _store;
        private readonly string _version;
        private readonly Action<string, string, string>? _showModSetting;
        private readonly List<UplinkSettingRow> _rows = new List<UplinkSettingRow>();
        private readonly List<KeyValuePair<string, string>> _migrations = new List<KeyValuePair<string, string>>();
        private readonly List<Deferred> _pendingWatches = new List<Deferred>();
        private readonly List<string> _storedNames = new List<string>();
        private readonly Dictionary<string, string> _stored = new Dictionary<string, string>(StringComparer.Ordinal);
        private bool _open = true;
        private bool _applied;

        public UplinkSettingsScope(
            SettingsStore store,
            string uplinkId,
            string uplinkVersion,
            Action<string, string, string>? showModSetting = null)
        {
            _store = store ?? throw new ArgumentNullException(nameof(store));
            _showModSetting = showModSetting;
            var refusal = SettingsText.RefusalOfName(uplinkId);
            if (refusal != null)
            {
                throw new ArgumentException("the Uplink id " + uplinkId + " cannot name a settings block: " + refusal, nameof(uplinkId));
            }

            BlockPath = "Uplinks/" + uplinkId;
            _version = uplinkVersion ?? string.Empty;
            WrittenBy = store.Text(PathOf(WrittenByName));
            var block = store.Document.Root.Block("Uplinks")?.Block(uplinkId);
            if (block != null)
            {
                foreach (var entry in block.Values)
                {
                    if (entry.Name != WrittenByName && !_stored.ContainsKey(entry.Name))
                    {
                        _storedNames.Add(entry.Name);
                        _stored[entry.Name] = entry.Text;
                    }
                }
            }
        }

        public string BlockPath { get; }

        public string? WrittenBy { get; }

        public IReadOnlyList<string> StoredNames => _storedNames;

        public string? Stored(string name) => _stored.TryGetValue(name, out var text) ? text : null;

        public void Declare(UplinkSettingRow row)
        {
            if (row == null)
            {
                throw new ArgumentNullException(nameof(row));
            }

            EnsureOpen(nameof(Declare));
            if (row.Name == WrittenByName)
            {
                throw new ArgumentException(WrittenByName + " is reserved for the version that saved the block", nameof(row));
            }

            // Constructing the host row is the check: it refuses a name or a
            // default the file cannot carry, and a default of the wrong kind.
            HostRow(row);
            _rows.Add(row);
        }

        public void Migrate(string name, string text)
        {
            EnsureOpen(nameof(Migrate));
            var path = PathOf(name);
            var refusal = SettingsText.RefusalOf(text);
            if (refusal != null)
            {
                throw new ArgumentException(path + ": " + refusal, nameof(text));
            }

            _migrations.Add(new KeyValuePair<string, string>(name, text));
        }

        /// <summary>
        /// Straight through, whether the declarer is running, returned or threw:
        /// a mod's setting is a fact about the mod, not part of this Uplink's
        /// declaration.
        /// </summary>
        public void ShowModSetting(string name, string label, string value)
        {
            if (string.IsNullOrEmpty(name))
            {
                throw new ArgumentException("a mod setting names itself", nameof(name));
            }

            _showModSetting?.Invoke(name, label ?? string.Empty, value ?? string.Empty);
        }

        public string? Text(string name)
        {
            if (!_applied)
            {
                return DefaultOf(name);
            }

            return _store.Text(PathOf(name)) ?? DefaultOf(name);
        }

        public bool Bool(string name) =>
            _applied ? _store.Bool(PathOf(name)) : SettingsText.ToBool(DefaultOf(name)) ?? false;

        public double Number(string name) =>
            _applied ? _store.Number(PathOf(name)) : SettingsText.ToNumber(DefaultOf(name)) ?? 0.0;

        public IDisposable OnChanged(Action<IUplinkSettings> callback)
        {
            if (callback == null)
            {
                throw new ArgumentNullException(nameof(callback));
            }

            if (_open)
            {
                var deferred = new Deferred(callback);
                _pendingWatches.Add(deferred);
                return deferred;
            }

            if (!_applied)
            {
                callback(this);
                return new Deferred(callback);
            }

            return _store.OnChanged(BlockPath, _ => callback(this));
        }

        /// <summary>
        /// Put everything the declarer said into the store: its rows, its
        /// migrations, the version stamp, then its subscriptions, each of which
        /// fires once as it is attached. Called only when the declarer returned.
        /// </summary>
        public void Apply()
        {
            _open = false;
            foreach (var row in _rows)
            {
                _store.Declare(HostRow(row));
            }

            foreach (var migration in _migrations)
            {
                _store.Seed(PathOf(migration.Key), migration.Value);
            }

            // The stamp names the version that last SAVED the block, so the file
            // keeps naming the older one until the operator's next save, and a
            // migration runs again at every start-up before then. That is why a
            // migration has to settle.
            if (_version.Length > 0)
            {
                _store.Seed(PathOf(WrittenByName), _version);
            }

            _applied = true;
            foreach (var watch in _pendingWatches)
            {
                if (!watch.Disposed)
                {
                    var callback = watch.Callback;
                    watch.Attach(_store.OnChanged(BlockPath, _ => callback(this)));
                }
            }

            _pendingWatches.Clear();
        }

        /// <summary>
        /// The declarer threw. Nothing it said reaches the store, and the handle
        /// is left answering with the defaults it declared before the throw.
        /// </summary>
        public void Abandon()
        {
            _open = false;
            _migrations.Clear();
            var watches = new List<Deferred>(_pendingWatches);
            _pendingWatches.Clear();
            foreach (var watch in watches)
            {
                if (watch.Disposed)
                {
                    continue;
                }

                try
                {
                    watch.Callback(this);
                }
                catch (Exception)
                {
                    // Same rule as the store's own watchers: one consumer's
                    // failure does not stop the others hearing the defaults.
                }
            }
        }

        private string PathOf(string name) => BlockPath + "/" + name;

        private SettingsRow HostRow(UplinkSettingRow row)
        {
            // A kind from a newer contract than this host knows becomes a text
            // row, the vocabulary's stated fallback, and the Uplink checks the
            // value itself when it reads it.
            var kind = Enum.IsDefined(typeof(SettingKind), row.Kind) ? row.Kind : SettingKind.Text;
            return new SettingsRow(PathOf(row.Name), kind, row.DefaultText, row.Label);
        }

        private string? DefaultOf(string name)
        {
            for (var i = _rows.Count - 1; i >= 0; i--)
            {
                if (_rows[i].Name == name)
                {
                    return _rows[i].DefaultText;
                }
            }

            return null;
        }

        private void EnsureOpen(string what)
        {
            if (!_open)
            {
                throw new InvalidOperationException(what + " is only valid inside DeclareSettings");
            }
        }

        /// <summary>A subscription made before the store has the block, which adopts the real one once <see cref="Apply"/> attaches it.</summary>
        private sealed class Deferred : IDisposable
        {
            private IDisposable? _attached;

            internal Deferred(Action<IUplinkSettings> callback)
            {
                Callback = callback;
            }

            internal Action<IUplinkSettings> Callback { get; }

            internal bool Disposed { get; private set; }

            internal void Attach(IDisposable attached) => _attached = attached;

            public void Dispose()
            {
                Disposed = true;
                _attached?.Dispose();
            }
        }
    }
}
