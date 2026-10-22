using System;
using System.Collections.Generic;

namespace Gonogo.KSP
{
    /// <summary>
    /// When each craft file was last launched. KSP keeps no launch date on a
    /// craft file, so every launch is written here and the book rides in the
    /// save through <c>CraftLaunchScenario</c>.
    ///
    /// <para>The editor's own Launch button does not launch the saved file: it
    /// saves the craft in the editor to <c>Auto-Saved Ship</c> and launches that.
    /// A launch from that file is recorded against the ship name instead, and
    /// credits every craft file in the same editor carrying that ship name,
    /// which is what the player launched. A launch from any other file, which is
    /// how the console launches, is recorded against the file.</para>
    ///
    /// <para>A craft launched before the book existed has no entry, and
    /// <see cref="NewestVesselLaunch"/> answers for it from the vessels already
    /// in the save.</para>
    /// </summary>
    public sealed class CraftLaunchLog
    {
        /// <summary>The file the editor's Launch button saves the craft to before launching it.</summary>
        public const string EditorLaunchFile = "Auto-Saved Ship";

        /// <summary>The book for the save being played, which outlives every scene.</summary>
        public static readonly CraftLaunchLog Current = new CraftLaunchLog();

        private readonly Dictionary<string, double> _byFile = new Dictionary<string, double>(StringComparer.Ordinal);
        private readonly Dictionary<string, double> _byShipName = new Dictionary<string, double>(StringComparer.Ordinal);
        private WeakReference? _owner;

        /// <summary>Every recorded launch, for the save to write.</summary>
        public IEnumerable<LaunchEntry> Entries
        {
            get
            {
                foreach (var pair in _byFile)
                {
                    var (facility, name) = Split(pair.Key);
                    yield return new LaunchEntry(facility, name, true, pair.Value);
                }
                foreach (var pair in _byShipName)
                {
                    var (facility, name) = Split(pair.Key);
                    yield return new LaunchEntry(facility, name, false, pair.Value);
                }
            }
        }

        /// <summary>
        /// Records a launch made from <paramref name="file"/> in
        /// <paramref name="facility"/> of a craft named <paramref name="shipName"/>.
        /// </summary>
        public void RecordLaunch(string facility, string file, string shipName, double ut)
        {
            if (string.IsNullOrEmpty(facility) || double.IsNaN(ut) || double.IsInfinity(ut))
            {
                return;
            }

            if (string.Equals(file, EditorLaunchFile, StringComparison.Ordinal))
            {
                Keep(_byShipName, Key(facility, shipName), ut);
            }
            else
            {
                Keep(_byFile, Key(facility, file), ut);
            }
        }

        /// <summary>Restores one saved entry.</summary>
        public void Restore(LaunchEntry entry)
        {
            Keep(entry.ByFile ? _byFile : _byShipName, Key(entry.Facility, entry.Name), entry.Ut);
        }

        /// <summary>
        /// Makes the book the record of <paramref name="game"/>, the loaded save: a
        /// different game from the last one adopted empties it, so a launch made on
        /// a timeline that a quickload, a revert or another save has left behind is
        /// not carried into this one. The same game, which is every scene change
        /// within one session, keeps what was recorded.
        /// </summary>
        public void Adopt(object? game)
        {
            if (game == null)
            {
                return;
            }

            if (_owner == null || !ReferenceEquals(_owner.Target, game))
            {
                Clear();
                _owner = new WeakReference(game);
            }
        }

        public void Clear()
        {
            _byFile.Clear();
            _byShipName.Clear();
        }

        /// <summary>
        /// The most recent recorded launch of the craft file
        /// <paramref name="file"/> whose ship name is <paramref name="shipName"/>,
        /// or null when none was recorded.
        /// </summary>
        public double? Recorded(string facility, string file, string shipName)
        {
            double? best = null;
            if (_byFile.TryGetValue(Key(facility, file), out var byFile))
            {
                best = byFile;
            }
            if (_byShipName.TryGetValue(Key(facility, shipName), out var byName) && (best == null || byName > best))
            {
                best = byName;
            }
            return best;
        }

        /// <summary>
        /// The launch time of the newest vessel named <paramref name="shipName"/>,
        /// or null when no vessel in the save carries that name.
        /// </summary>
        public static double? NewestVesselLaunch(IEnumerable<KeyValuePair<string, double>> vessels, string shipName)
        {
            double? newest = null;
            foreach (var vessel in vessels)
            {
                if (string.Equals(vessel.Key, shipName, StringComparison.Ordinal) && (newest == null || vessel.Value > newest))
                {
                    newest = vessel.Value;
                }
            }
            return newest;
        }

        private static void Keep(Dictionary<string, double> into, string key, double ut)
        {
            if (!into.TryGetValue(key, out var kept) || ut > kept)
            {
                into[key] = ut;
            }
        }

        private static string Key(string facility, string name) => facility + "/" + name;

        private static (string Facility, string Name) Split(string key)
        {
            var slash = key.IndexOf('/');
            return (key.Substring(0, slash), key.Substring(slash + 1));
        }

        /// <summary>One saved launch: a file, or a ship name when the launch came through the editor.</summary>
        public readonly struct LaunchEntry
        {
            public LaunchEntry(string facility, string name, bool byFile, double ut)
            {
                Facility = facility;
                Name = name;
                ByFile = byFile;
                Ut = ut;
            }

            public string Facility { get; }

            /// <summary>The craft file name when <see cref="ByFile"/>, otherwise the ship name.</summary>
            public string Name { get; }

            public bool ByFile { get; }

            public double Ut { get; }
        }
    }
}
