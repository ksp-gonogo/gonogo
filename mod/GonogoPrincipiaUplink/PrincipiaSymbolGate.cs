using System;
using System.Collections.Generic;
using System.IO;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Whether a native build carries every function a caller intends to call.
    /// </summary>
    public readonly struct PrincipiaSymbolCheck
    {
        private static readonly string[] NothingMissing = new string[0];

        private PrincipiaSymbolCheck(
            bool complete,
            NativeBinaryFormat format,
            int exportCount,
            IReadOnlyList<string> missing,
            string? reason)
        {
            Complete = complete;
            Format = format;
            ExportCount = exportCount;
            Missing = missing;
            Reason = reason;
        }

        /// <summary>
        /// Every intended name was found. False whenever anything was missing AND
        /// whenever nothing could be checked, so this can be read on its own.
        /// </summary>
        public bool Complete { get; }

        public NativeBinaryFormat Format { get; }

        /// <summary>How many names the build exports in total. Zero when unread.</summary>
        public int ExportCount { get; }

        /// <summary>
        /// The intended names the build does not export, in order. Empty when
        /// <see cref="Reason"/> is set, because nothing was looked for.
        /// </summary>
        public IReadOnlyList<string> Missing { get; }

        /// <summary>
        /// Why no comparison happened at all. Null once one did, whatever it found,
        /// which is what separates "this build is wrong" from "we could not tell".
        /// </summary>
        public string? Reason { get; }

        internal static PrincipiaSymbolCheck Unchecked(NativeBinaryFormat format, string reason) =>
            new PrincipiaSymbolCheck(false, format, 0, NothingMissing, reason);

        internal static PrincipiaSymbolCheck Compared(
            NativeBinaryFormat format,
            int exportCount,
            IReadOnlyList<string> missing) =>
            new PrincipiaSymbolCheck(missing.Count == 0, format, exportCount, missing, null);
    }

    /// <summary>
    /// Confirms a Principia native build exports the functions we mean to call,
    /// by name, before any of them is called.
    ///
    /// <para>What this buys over finding out at call time: Principia's native
    /// surface aborts the KSP process rather than returning an error, so a call
    /// into a build whose interface moved takes the player's game down with it.
    /// Reading the export table costs a file read and names the missing functions
    /// while everything is still recoverable.</para>
    ///
    /// <para>The intended names are an argument rather than a list held here, so
    /// every case (all present, some absent, an unreadable file, an empty ask) is a
    /// test rather than a rig session.</para>
    /// </summary>
    public static class PrincipiaSymbolGate
    {
        /// <summary>
        /// What Principia names its C interface. Its 170 exports all begin with
        /// this, on every platform, once the platform's own prefix is off.
        /// </summary>
        public const string ExportPrefix = "principia__";

        public static PrincipiaSymbolCheck Check(Stream? stream, IEnumerable<string>? intended) =>
            Check(NativeExportReader.Read(stream), intended);

        public static PrincipiaSymbolCheck Check(NativeExports exports, IEnumerable<string>? intended)
        {
            if (!exports.Found)
            {
                return PrincipiaSymbolCheck.Unchecked(
                    exports.Format,
                    exports.Reason ?? "The build's exports could not be read.");
            }

            var wanted = new List<string>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            if (intended != null)
            {
                foreach (var name in intended)
                {
                    if (!string.IsNullOrWhiteSpace(name) && seen.Add(name))
                    {
                        wanted.Add(name);
                    }
                }
            }

            if (wanted.Count == 0)
            {
                // A pass here would be the emptiest possible one: nothing was asked
                // for, so nothing was confirmed, and a caller that built its list
                // from a source that came back empty would read that as a healthy
                // build.
                return PrincipiaSymbolCheck.Unchecked(
                    exports.Format,
                    "No function names were given, so nothing about this build was confirmed.");
            }

            var missing = new List<string>();
            foreach (var name in wanted)
            {
                if (!exports.Contains(name))
                {
                    missing.Add(name);
                }
            }

            return PrincipiaSymbolCheck.Compared(exports.Format, exports.Count, missing);
        }

        /// <summary>
        /// The exports belonging to Principia's own C interface, which is every name
        /// under <see cref="ExportPrefix"/>. Sorted, so two builds can be compared
        /// by their lists.
        /// </summary>
        public static IReadOnlyList<string> InterfaceExports(NativeExports exports)
        {
            var found = new List<string>();
            foreach (var name in exports.Names)
            {
                if (name.StartsWith(ExportPrefix, StringComparison.Ordinal))
                {
                    found.Add(name);
                }
            }
            found.Sort(StringComparer.Ordinal);
            return found;
        }
    }
}
