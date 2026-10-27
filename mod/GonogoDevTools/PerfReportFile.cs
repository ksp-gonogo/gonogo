using System;
using System.IO;

namespace Gonogo.DevTools
{
    /// <summary>
    /// The JSON lines file a perf report goes to. Nothing is created or written
    /// while <see cref="Enabled"/> is false.
    /// </summary>
    internal sealed class PerfReportFile
    {
        private readonly string _path;

        public PerfReportFile(string path)
        {
            _path = path;
        }

        public bool Enabled { get; set; }

        /// <summary>Appends <paramref name="members"/> as one line, wrapped in braces with the UTC time first. Returns false when off.</summary>
        public bool Append(DateTime utcNow, string members)
        {
            if (!Enabled)
            {
                return false;
            }

            var dir = Path.GetDirectoryName(_path);
            if (!string.IsNullOrEmpty(dir))
            {
                Directory.CreateDirectory(dir!);
            }
            File.AppendAllText(_path, "{\"time\":\"" + utcNow.ToString("O", System.Globalization.CultureInfo.InvariantCulture) + "\"," + members + "}\n");
            return true;
        }
    }
}
