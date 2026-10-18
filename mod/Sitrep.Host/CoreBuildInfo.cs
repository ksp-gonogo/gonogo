using System;
using System.IO;

namespace Sitrep.Host
{
    /// <summary>
    /// The release this mod was built as: the <c>version=</c> line of the
    /// <c>build-info.txt</c> the release build writes beside the mod's DLLs, a
    /// tag such as <c>v1.4.0</c> or a candidate label such as <c>rc-abc1234</c>.
    /// Null for a build that carries no such file, which is every local build.
    /// </summary>
    public static class CoreBuildInfo
    {
        private const string FileName = "build-info.txt";

        private static readonly Lazy<string?> Label = new Lazy<string?>(ReadBesideAssembly);

        /// <summary>The release label, or null when the build carries none.</summary>
        public static string? Version => Label.Value;

        /// <summary>The <c>version=</c> value of a build-info file's text, or null when it has none.</summary>
        public static string? ParseVersion(string text)
        {
            foreach (var raw in text.Split('\n'))
            {
                var line = raw.Trim();
                if (!line.StartsWith("version=", StringComparison.Ordinal))
                {
                    continue;
                }

                var value = line.Substring("version=".Length).Trim();
                return value.Length == 0 ? null : value;
            }

            return null;
        }

        private static string? ReadBesideAssembly()
        {
            try
            {
                var dir = Path.GetDirectoryName(typeof(CoreBuildInfo).Assembly.Location);
                if (string.IsNullOrEmpty(dir))
                {
                    return null;
                }

                var path = Path.Combine(dir, FileName);
                return File.Exists(path) ? ParseVersion(File.ReadAllText(path)) : null;
            }
            catch (Exception)
            {
                // A version the mod cannot read is one it does not report; the stream must not fail over it.
                return null;
            }
        }
    }
}
