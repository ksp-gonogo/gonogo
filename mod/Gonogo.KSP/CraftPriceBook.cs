using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

namespace Gonogo.KSP
{
    /// <summary>
    /// Each saved craft's price with its modules, kept on disk across launches. A price
    /// answers only for the craft file version it was taken from (its write stamp) and
    /// for the install's parts as they were then (a fingerprint of every part's name and
    /// cost and of the loaded assemblies). Under any other fingerprint it is not
    /// answered, so a craft is priced again rather than shown at a price from another
    /// parts set. Main thread only.
    /// </summary>
    internal sealed class CraftPriceBook
    {
        private readonly struct Price
        {
            public Price(long stamp, string fingerprint, double? cost)
            {
                Stamp = stamp;
                Fingerprint = fingerprint;
                Cost = cost;
            }

            public long Stamp { get; }

            public string Fingerprint { get; }

            public double? Cost { get; }
        }

        private readonly string _path;
        private readonly Func<string, bool> _fileExists;
        private readonly Action<string, Exception>? _fault;
        private Dictionary<string, Price>? _prices;

        /// <param name="path">The file the book is kept in.</param>
        /// <param name="fault">Told when the file cannot be read or written; the book then starts empty or stays in memory.</param>
        /// <param name="fileExists">Whether a craft file is still there; a price for one that is gone is dropped when the book is written.</param>
        public CraftPriceBook(string path, Action<string, Exception>? fault = null, Func<string, bool>? fileExists = null)
        {
            _path = path;
            _fault = fault;
            _fileExists = fileExists ?? File.Exists;
        }

        /// <summary>
        /// The price taken for <paramref name="file"/> at <paramref name="stamp"/> under
        /// <paramref name="fingerprint"/>. A known price may be null: the craft could not
        /// be priced, which is not tried again for that version.
        /// </summary>
        public bool TryGet(string file, long stamp, string fingerprint, out double? cost)
        {
            if (Prices().TryGetValue(file, out var price) && price.Stamp == stamp
                && string.Equals(price.Fingerprint, fingerprint, StringComparison.Ordinal))
            {
                cost = price.Cost;
                return true;
            }

            cost = null;
            return false;
        }

        /// <summary>Keeps a price and writes the book.</summary>
        public void Put(string file, long stamp, string fingerprint, double? cost)
        {
            Prices()[file] = new Price(stamp, fingerprint, cost);
            Write();
        }

        private Dictionary<string, Price> Prices()
        {
            if (_prices != null)
            {
                return _prices;
            }

            _prices = new Dictionary<string, Price>(StringComparer.Ordinal);
            try
            {
                if (File.Exists(_path))
                {
                    foreach (var line in File.ReadAllLines(_path, Encoding.UTF8))
                    {
                        var fields = line.Split(new[] { '\t' }, 4);
                        if (fields.Length != 4
                            || !long.TryParse(fields[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out var stamp))
                        {
                            continue;
                        }

                        double? cost = null;
                        if (fields[2] != "-")
                        {
                            if (!double.TryParse(fields[2], NumberStyles.Float, CultureInfo.InvariantCulture, out var value))
                            {
                                continue;
                            }
                            cost = value;
                        }
                        _prices[fields[3]] = new Price(stamp, fields[1], cost);
                    }
                }
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                _fault?.Invoke("craft price book could not be read, pricing again", ex);
            }

            return _prices;
        }

        private void Write()
        {
            var text = new StringBuilder();
            foreach (var pair in Prices())
            {
                if (!_fileExists(pair.Key))
                {
                    continue;
                }

                text.Append(pair.Value.Stamp.ToString(CultureInfo.InvariantCulture)).Append('\t')
                    .Append(pair.Value.Fingerprint).Append('\t')
                    .Append(pair.Value.Cost is double cost ? cost.ToString("R", CultureInfo.InvariantCulture) : "-").Append('\t')
                    .Append(pair.Key).Append('\n');
            }

            try
            {
                var directory = Path.GetDirectoryName(_path);
                if (!string.IsNullOrEmpty(directory))
                {
                    Directory.CreateDirectory(directory);
                }
                var temporary = _path + ".tmp";
                File.WriteAllText(temporary, text.ToString(), Encoding.UTF8);
                if (File.Exists(_path))
                {
                    File.Delete(_path);
                }
                File.Move(temporary, _path);
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                _fault?.Invoke("craft price book could not be written", ex);
            }
        }

        /// <summary>
        /// The fingerprint of a parts set: every part's name and cost, and every loaded
        /// assembly's name and version, in any order. A change to any of them is a new
        /// fingerprint.
        /// </summary>
        public static string Fingerprint(IEnumerable<KeyValuePair<string, double>> partCosts, IEnumerable<string> assemblies)
        {
            var lines = new List<string>();
            foreach (var part in partCosts)
            {
                lines.Add("p " + part.Key + "=" + part.Value.ToString("R", CultureInfo.InvariantCulture));
            }
            foreach (var assembly in assemblies)
            {
                lines.Add("a " + assembly);
            }
            lines.Sort(StringComparer.Ordinal);

            using (var sha = System.Security.Cryptography.SHA256.Create())
            {
                var hash = sha.ComputeHash(Encoding.UTF8.GetBytes(string.Join("\n", lines)));
                var hex = new StringBuilder(32);
                for (var i = 0; i < 16; i++)
                {
                    hex.Append(hash[i].ToString("x2", CultureInfo.InvariantCulture));
                }
                return hex.ToString();
            }
        }
    }
}
