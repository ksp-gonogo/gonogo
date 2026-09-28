using System;
using System.Collections.Generic;
using System.Globalization;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// An <see cref="IUplinkSettings"/> for an Uplink's own tests: hand it the
    /// block as a stored file would hold it, run the Uplink's
    /// <see cref="IUplinkSettingsDeclarer.DeclareSettings"/> against it, and read
    /// back what was declared and migrated.
    ///
    /// <para>It refuses what the host refuses, so a declaration that passes here
    /// passes at start-up. It keeps no file: a change it hears about comes only
    /// from <see cref="Change"/>.</para>
    /// </summary>
    public sealed class RecordingUplinkSettings : IUplinkSettings
    {
        private readonly Dictionary<string, string> _stored;
        private readonly Dictionary<string, string> _values;
        private readonly List<UplinkSettingRow> _declared = new List<UplinkSettingRow>();
        private readonly List<Action<IUplinkSettings>> _watches = new List<Action<IUplinkSettings>>();
        private bool _open = true;

        public RecordingUplinkSettings(IReadOnlyDictionary<string, string>? stored = null, string? writtenBy = null)
        {
            _stored = new Dictionary<string, string>(StringComparer.Ordinal);
            if (stored != null)
            {
                foreach (var entry in stored)
                {
                    _stored[entry.Key] = entry.Value;
                }
            }

            _values = new Dictionary<string, string>(_stored, StringComparer.Ordinal);
            WrittenBy = writtenBy;
        }

        public string? WrittenBy { get; }

        public IReadOnlyList<string> StoredNames => new List<string>(_stored.Keys);

        /// <summary>Every row declared, in order.</summary>
        public IReadOnlyList<UplinkSettingRow> Declared => _declared;

        /// <summary>Every value in force after declaring: stored or migrated, else the declared default.</summary>
        public IReadOnlyDictionary<string, string> InForce
        {
            get
            {
                var inForce = new Dictionary<string, string>(_values, StringComparer.Ordinal);
                foreach (var row in _declared)
                {
                    if (!inForce.ContainsKey(row.Name))
                    {
                        inForce[row.Name] = row.DefaultText;
                    }
                }

                return inForce;
            }
        }

        public string? Stored(string name) => _stored.TryGetValue(name, out var text) ? text : null;

        public void Declare(UplinkSettingRow row)
        {
            if (row == null)
            {
                throw new ArgumentNullException(nameof(row));
            }

            EnsureOpen(nameof(Declare));
            if (row.Name == UplinkSettingRow.WrittenByName)
            {
                throw new ArgumentException(row.Name + " is reserved for the version that saved the block", nameof(row));
            }

            var refusal = SettingsEncoding.RefusalOfName(row.Name) ?? SettingsEncoding.RefusalOf(row.DefaultText);
            if (refusal != null)
            {
                throw new ArgumentException(row.Name + ": " + refusal, nameof(row));
            }

            if (!IsOfKind(row.Kind, row.DefaultText))
            {
                throw new ArgumentException(
                    row.Name + ": the default " + row.DefaultText + " is not a " + row.Kind + " value", nameof(row));
            }

            _declared.Add(row);
        }

        public void Migrate(string name, string text)
        {
            EnsureOpen(nameof(Migrate));
            var refusal = SettingsEncoding.RefusalOfName(name) ?? SettingsEncoding.RefusalOf(text);
            if (refusal != null)
            {
                throw new ArgumentException(name + ": " + refusal, nameof(text));
            }

            _values[name] = text;
        }

        public string? Text(string name)
        {
            if (_values.TryGetValue(name, out var text))
            {
                return text;
            }

            for (var i = _declared.Count - 1; i >= 0; i--)
            {
                if (_declared[i].Name == name)
                {
                    return _declared[i].DefaultText;
                }
            }

            return null;
        }

        public bool Bool(string name) => bool.TryParse(Text(name), out var value) && value;

        public double Number(string name) =>
            double.TryParse(Text(name), NumberStyles.Float, CultureInfo.InvariantCulture, out var value) ? value : 0.0;

        public IDisposable OnChanged(Action<IUplinkSettings> callback)
        {
            if (callback == null)
            {
                throw new ArgumentNullException(nameof(callback));
            }

            _watches.Add(callback);
            if (!_open)
            {
                callback(this);
            }

            return new Unsubscribe(() => _watches.Remove(callback));
        }

        /// <summary>
        /// End the declaring phase, as the host does when
        /// <see cref="IUplinkSettingsDeclarer.DeclareSettings"/> returns. A
        /// subscription taken while declaring hears the values now.
        /// </summary>
        public void Close()
        {
            _open = false;
            foreach (var watch in new List<Action<IUplinkSettings>>(_watches))
            {
                watch(this);
            }
        }

        /// <summary>Change a value as an operator's save would, and tell every subscriber.</summary>
        public void Change(string name, string text)
        {
            _values[name] = text;
            foreach (var watch in new List<Action<IUplinkSettings>>(_watches))
            {
                watch(this);
            }
        }

        internal static bool IsOfKind(SettingKind kind, string text)
        {
            switch (kind)
            {
                case SettingKind.Bool:
                    return bool.TryParse(text, out _);
                case SettingKind.Number:
                    return double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out _);
                case SettingKind.Text:
                    return true;
                default:
                    // A kind newer than this assembly knows reads as text, the
                    // vocabulary's stated fallback.
                    return true;
            }
        }

        private void EnsureOpen(string what)
        {
            if (!_open)
            {
                throw new InvalidOperationException(what + " is only valid inside DeclareSettings");
            }
        }

        private sealed class Unsubscribe : IDisposable
        {
            private readonly Action _action;

            internal Unsubscribe(Action action)
            {
                _action = action;
            }

            public void Dispose() => _action();
        }
    }
}
