using System;
using System.Globalization;
using System.Text;

namespace Sitrep.Host
{
    /// <summary>
    /// The topic one saved craft file's part tree is published on,
    /// <c>spaceCenter.craft.&lt;facility&gt;.&lt;file&gt;.parts</c>.
    ///
    /// <para>The file name is one topic segment whatever it holds: every byte
    /// outside <c>A-Z a-z 0-9 _ -</c> is written as <c>%</c> and two uppercase
    /// hexadecimal digits of its UTF-8 encoding. The client writes the same
    /// escaping, so the two sides agree on the topic without a lookup.</para>
    /// </summary>
    public static class CraftFileTopic
    {
        /// <summary>The namespace every craft file's topic sits under.</summary>
        public const string Prefix = "spaceCenter.craft.";

        private const string PartsSuffix = ".parts";

        /// <summary>The topic for <paramref name="file"/> in <paramref name="facility"/> (<c>VAB</c> or <c>SPH</c>).</summary>
        public static string For(string facility, string file) => Prefix + Key(facility, file);

        /// <summary>The topic without <see cref="Prefix"/>, the key a publisher in that namespace takes.</summary>
        public static string Key(string facility, string file) => facility + "." + EscapeSegment(file) + PartsSuffix;

        /// <summary>Writes <paramref name="value"/> as one topic segment.</summary>
        public static string EscapeSegment(string value)
        {
            var sb = new StringBuilder();
            foreach (var b in Encoding.UTF8.GetBytes(value))
            {
                var c = (char)b;
                if (b < 0x80 && (char.IsLetterOrDigit(c) || c == '_' || c == '-'))
                {
                    sb.Append(c);
                }
                else
                {
                    sb.Append('%').Append(b.ToString("X2", CultureInfo.InvariantCulture));
                }
            }
            return sb.ToString();
        }
    }
}
