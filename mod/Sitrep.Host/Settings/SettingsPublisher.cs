using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Settings
{
    /// <summary>
    /// The settings store as <c>settings.gonogo</c> reads it, and the
    /// <c>settings.save</c> command that writes it.
    ///
    /// <para><b>A snapshot, not a view.</b> The store changes on the main
    /// thread and the channel source is read on another, so every change
    /// rebuilds an immutable payload and the source only ever hands that out.
    /// A commit made by any other path, such as a command of the mod's own,
    /// rebuilds it too.</para>
    /// </summary>
    public sealed class SettingsPublisher
    {
        /// <summary>The owner of every row that is not under an Uplink's own block.</summary>
        public const string CoreOwner = "gonogo";

        private readonly SettingsStore _store;
        private readonly Func<IReadOnlyDictionary<string, string>> _undeclared;
        private readonly Func<double> _nowUt;
        private double? _savedAtUt;
        private volatile Dictionary<string, object?> _snapshot = new Dictionary<string, object?>();

        public SettingsPublisher(
            SettingsStore store,
            Func<IReadOnlyDictionary<string, string>> undeclared,
            Func<double> nowUt)
        {
            _store = store ?? throw new ArgumentNullException(nameof(store));
            _undeclared = undeclared ?? throw new ArgumentNullException(nameof(undeclared));
            _nowUt = nowUt ?? throw new ArgumentNullException(nameof(nowUt));
            var earlier = _store.Committed;
            _store.Committed = () =>
            {
                earlier?.Invoke();
                if (_store.LastWrite.Success)
                {
                    _savedAtUt = _nowUt();
                }

                Rebuild();
            };
            Rebuild();
        }

        /// <summary>The latest payload, for the channel source. Safe to read from any thread.</summary>
        public object Snapshot => _snapshot;

        /// <summary>Rebuild the payload from the store as it stands. Call on the thread that changes the store.</summary>
        public void Rebuild()
        {
            var rows = new List<SettingsWire.Row>();
            foreach (var row in _store.DeclaredRows)
            {
                rows.Add(new SettingsWire.Row(row, OwnerOf(row.Path), _store.Text(row.Path) ?? row.DefaultText));
            }

            var (state, reason) = Persistence();
            _snapshot = SettingsWire.BuildModel(rows, _store.Path, state, _savedAtUt, reason, _undeclared());
        }

        /// <summary>
        /// One SAVE press. Every change is checked before any is applied, so a
        /// refusal changes nothing; the accepted ones are then applied and
        /// written once. A write that fails is not a refusal: the values are in
        /// force, and the payload says the file does not hold them.
        /// </summary>
        public CommandResult Save(SaveSettingsArgs? args)
        {
            if (args == null)
            {
                return CommandResult.Fail(CommandErrorCode.Range, "no settings were given");
            }

            var changes = args.Changes ?? new List<SettingsChange>();
            foreach (var change in changes)
            {
                var refusal = change == null
                    ? "a change named nothing"
                    : _store.RefusalToSave(change.Path, change.Value ?? string.Empty);
                if (refusal != null)
                {
                    return CommandResult.Fail(CommandErrorCode.Range, refusal);
                }
            }

            foreach (var change in changes)
            {
                _store.Stage(change.Path, change.Value ?? string.Empty);
            }

            var written = _store.Commit();
            return written.Success
                ? CommandResult.Ok()
                : new CommandResult
                {
                    Success = true,
                    Detail = "in force for this session only, " + _store.Path + " could not be written: " + written.Reason,
                };
        }

        private static string OwnerOf(string path)
        {
            const string prefix = "Uplinks/";
            if (!path.StartsWith(prefix, StringComparison.Ordinal))
            {
                return CoreOwner;
            }

            var end = path.IndexOf('/', prefix.Length);
            return end < 0 ? CoreOwner : path.Substring(prefix.Length, end - prefix.Length);
        }

        /// <summary>
        /// Where the values in force stand against the file: the last write's
        /// outcome once there has been one this session, otherwise what start-up
        /// managed to read.
        /// </summary>
        private (SettingsPersistenceState State, string? Reason) Persistence()
        {
            var last = _store.LastWrite;
            if (!ReferenceEquals(last, WriteOutcome.NotAttempted))
            {
                return last.Success
                    ? (SettingsPersistenceState.Saved, (string?)null)
                    : (SettingsPersistenceState.MemoryOnly, last.Reason);
            }

            switch (_store.LoadedFrom)
            {
                case SettingsReadSource.File:
                    return (SettingsPersistenceState.Saved, null);
                case SettingsReadSource.Backup:
                    return (SettingsPersistenceState.Recovered,
                        _store.Path + " was missing, empty or damaged at start-up, so its backup was read");
                case SettingsReadSource.NoFile:
                    return (SettingsPersistenceState.Defaults, null);
                case SettingsReadSource.Unreadable:
                    return (SettingsPersistenceState.Unreadable,
                        _store.Path + " could not be read and no backup of it could either");
                default:
                    return Unnamed(_store.LoadedFrom);
            }
        }

        private static (SettingsPersistenceState, string?) Unnamed(SettingsReadSource source) =>
            throw new InvalidOperationException("no persistence state for the read source " + source);
    }
}
