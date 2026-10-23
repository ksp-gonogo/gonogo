using System.Collections.Generic;

namespace Gonogo.KSP
{
    /// <summary>
    /// What the saved-ships scan keeps of a craft file KSP could not build, so
    /// the next scan of the same unchanged file does not hand it to KSP again.
    ///
    /// <para>KSP's craft reader writes a "Could not locate root part" line to
    /// its log each time it is given a craft that names a part this install
    /// lacks, so a rescan of the same file repeats the line. A file is read
    /// again only when it was written since, which is what the stamp tells.</para>
    ///
    /// <para>Carries no KSP type, so a headless test can enter it.</para>
    /// </summary>
    internal sealed class SavedShipParseMemo
    {
        private readonly Dictionary<string, Remembered> _files = new Dictionary<string, Remembered>();

        /// <summary>The scan entry as KSP's reader built it, and the part names the craft uses.</summary>
        internal sealed class Remembered
        {
            public Remembered(long stamp, Dictionary<string, object?> fields, IReadOnlyList<string> partNames)
            {
                Stamp = stamp;
                Fields = fields;
                PartNames = partNames;
            }

            public long Stamp { get; }

            public Dictionary<string, object?> Fields { get; }

            public IReadOnlyList<string> PartNames { get; }
        }

        /// <summary>The remembered craft, when this file has not been written since it was remembered.</summary>
        public Remembered? Recall(string path, long stamp) =>
            _files.TryGetValue(path, out var remembered) && remembered.Stamp == stamp ? remembered : null;

        public void Remember(string path, long stamp, Dictionary<string, object?> fields, IReadOnlyList<string> partNames) =>
            _files[path] = new Remembered(stamp, fields, partNames);

        /// <summary>Drops every file the latest scan did not see, so a deleted craft is not held for good.</summary>
        public void Retain(ICollection<string> seen)
        {
            var gone = new List<string>();
            foreach (var path in _files.Keys)
            {
                if (!seen.Contains(path))
                {
                    gone.Add(path);
                }
            }
            foreach (var path in gone)
            {
                _files.Remove(path);
            }
        }
    }
}
