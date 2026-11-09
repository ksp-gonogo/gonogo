using System;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Sitrep.Host
{
    /// <summary>
    /// The save files behind <c>ksp.saves</c>, read as files: nothing here knows
    /// about a game, so it is testable without one.
    /// </summary>
    public static class SaveFiles
    {
        /// <summary>The name of the quicksave slot, without its extension.</summary>
        public const string Quicksave = "quicksave";

        /// <summary>Where the save a quicksave replaced is kept, relative to the game's save folder, without its extension.</summary>
        public const string PreviousQuicksave = "Gonogo/quicksave.previous";

        /// <summary>An identifier for this file at this moment: a file rewritten since has another one.</summary>
        public static string IdOf(string folder, string relativeName, long size, DateTime writtenUtc)
        {
            var identity = folder + "|" + relativeName + "|" + size.ToString(CultureInfo.InvariantCulture)
                + "|" + writtenUtc.Ticks.ToString(CultureInfo.InvariantCulture);
            using var sha = SHA1.Create();
            var hash = sha.ComputeHash(Encoding.UTF8.GetBytes(identity));
            var hex = new StringBuilder(hash.Length * 2);
            foreach (var b in hash)
            {
                hex.Append(b.ToString("x2", CultureInfo.InvariantCulture));
            }
            return hex.ToString();
        }

        /// <summary>
        /// The universal time a save holds, from the <c>UT</c> line of its
        /// <c>FLIGHTSTATE</c> block, or null when the file has none. Reads line by
        /// line and stops there, because a modded save runs to tens of megabytes.
        /// </summary>
        public static double? ReadFlightStateUt(TextReader reader)
        {
            var inFlightState = false;
            for (var line = reader.ReadLine(); line != null; line = reader.ReadLine())
            {
                var trimmed = line.Trim();
                if (!inFlightState)
                {
                    inFlightState = trimmed == "FLIGHTSTATE";
                    continue;
                }
                if (trimmed.StartsWith("UT", StringComparison.Ordinal))
                {
                    var equals = trimmed.IndexOf('=');
                    if (equals > 0 && trimmed.Substring(0, equals).Trim() == "UT"
                        && double.TryParse(trimmed.Substring(equals + 1).Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var ut))
                    {
                        return ut;
                    }
                }
                if (trimmed == "VESSEL")
                {
                    return null;
                }
            }
            return null;
        }
    }
}
