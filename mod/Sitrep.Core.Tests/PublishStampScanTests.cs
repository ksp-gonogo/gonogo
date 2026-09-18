using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// The second argument to <c>IChannelPublisher.Publish</c> is a universe
    /// time, and nothing in the tree checked that the expression handed over is
    /// one.
    ///
    /// <para><b>Why a bad stamp goes unnoticed.</b> The engine's only sanity
    /// check on a caller-supplied stamp is a FORWARD clamp (see
    /// <c>ChannelEngine.ProcessPublish</c>): a stamp ahead of the clock is
    /// pulled back to now, but a stamp far BEHIND it, which a small count
    /// always is, is recorded exactly as given, with no test, log line or
    /// clamp catching it.</para>
    ///
    /// <para><b>Why a scan rather than a per-uplink assertion.</b> A test that
    /// pins one publisher's stamp catches that publisher's regression and
    /// nothing else; seventy-seven other call sites have the same argument in
    /// the same position and were equally unchecked. This reads the stamp
    /// expression at every one of them and asks the one question the type system
    /// cannot: does this expression NAME a time. Both are worth having, and
    /// <c>Gonogo.KSP.Tests.CommandCentres.CommandCentreRosterStampTests</c> is
    /// the behavioural half.</para>
    /// </summary>
    public class PublishStampScanTests
    {
        [Fact]
        public void EveryPublishIsStampedWithSomethingThatNamesATime()
        {
            var sites = PublishSites(ProducerFieldParityTests.ResolveModDir());

            var offenders = sites.Where(site => !NamesATime(site.Stamp)).ToList();

            Assert.True(
                offenders.Count == 0,
                "Publish() takes a universe time as its LAST argument. These call sites hand it an "
                    + "expression that does not name one, and the engine will record the sample at "
                    + "whatever number it is, because its only check on a stamp is a forward clamp:\n  "
                    + string.Join("\n  ", offenders.Select(o => o.File + ": Publish(..., " + o.Stamp + ")")));
        }

        /// <summary>
        /// The scan sees the call sites it is meant to judge.
        ///
        /// <para>This runs in two halves. Over a planted tree the scan returns
        /// exactly the planted stamps and nothing from a test project beside
        /// them. Over the real tree
        /// the files it found a site in are exactly the production files whose
        /// text contains <c>.Publish(</c> at all, a plain substring read that
        /// shares nothing with the argument splitter, so a site the splitter drops
        /// shows up as a disagreement at any size of tree.</para>
        /// </summary>
        [Fact]
        public void TheScanSeesThePublishCallsItJudges()
        {
            var root = Path.Combine(Path.GetTempPath(), "publish-stamp-" + Guid.NewGuid().ToString("N"));
            try
            {
                WritePlanted(root, "Planted.Backend", "Backend.cs",
                    "class Backend { void Tick(IChannelPublisher publisher, Snapshot cap) {\n"
                    + "    publisher.Publish(new { a = 1, b = (2, 3) }, cap.Ut);\n"
                    + "    _roster.Publish(cap.Roster, cap.Roster.Count);\n"
                    + "} }\n");
                WritePlanted(root, "Planted.Backend.Tests", "BackendDouble.cs",
                    "class Double { void Tick() { publisher.Publish(payload, 42); } }\n");

                var planted = PublishSites(root).Select(s => s.File + " " + s.Stamp).ToList();
                Assert.Equal(
                    new[] { "mod/Planted.Backend/Backend.cs cap.Ut", "mod/Planted.Backend/Backend.cs cap.Roster.Count" },
                    planted);
            }
            finally
            {
                Directory.Delete(root, recursive: true);
            }

            var modDir = ProducerFieldParityTests.ResolveModDir();
            var withSites = PublishSites(modDir).Select(s => s.File).ToHashSet(StringComparer.Ordinal);
            var mentioning = ProducerFlattenScan.ProductionSources(modDir)
                .Where(s => s.Text.Contains(".Publish(", StringComparison.Ordinal))
                .Select(s => s.Path)
                .ToHashSet(StringComparer.Ordinal);

            Assert.True(
                withSites.SetEquals(mentioning),
                "The publish scan and a plain substring read disagree about which production files "
                    + "publish. Mentioning .Publish( with no site read: ["
                    + string.Join(", ", mentioning.Except(withSites).OrderBy(p => p, StringComparer.Ordinal))
                    + "]. Sites read in a file that never mentions it: ["
                    + string.Join(", ", withSites.Except(mentioning).OrderBy(p => p, StringComparer.Ordinal))
                    + "]. A scan that has stopped matching reports a clean tree.");
        }

        private static void WritePlanted(string root, string project, string file, string source)
        {
            var directory = Path.Combine(root, project);
            Directory.CreateDirectory(directory);
            File.WriteAllText(Path.Combine(directory, file), source);
        }

        /// <summary>
        /// The check can SEE a bad stamp, planted in every shape the real defect
        /// could take. Without this the test would report a clean tree just as
        /// happily if <see cref="NamesATime"/> said yes to everything, which is
        /// the failure mode a scan is most prone to and least able to announce.
        /// </summary>
        [Theory]
        [InlineData("cap.Roster.Count")]
        [InlineData("roster.Count")]
        [InlineData("entries.Length")]
        [InlineData("vessels.Count()")]
        [InlineData("index")]
        [InlineData("capture.VesselId")]
        [InlineData("raw?.Ut ?? 0.0")]
        [InlineData("raw?.Ut ?? 0")]
        [InlineData("raw?.Ut ?? snapshot?.Ut ?? 0.0")]
        [InlineData("0.0")]
        [InlineData("0")]
        [InlineData("1.5d")]
        [InlineData("nowUt.GetValueOrDefault()")] // the substitution, spelled as an unwrap
        [InlineData("nowUt.GetValueOrDefault(0)")]
        public void AStampThatNamesSomethingElseIsRejected(string stamp) =>
            Assert.False(NamesATime(stamp), stamp + " is not a universe time and must be rejected");

        /// <summary>
        /// Every spelling the tree actually uses is accepted, so the gate cannot
        /// be satisfied by narrowing it until nothing passes. The last one is the
        /// half of the coalesce branch that survives: a fallback quoting a clock
        /// is a stamp, where a fallback quoting a constant is not.
        /// </summary>
        [Theory]
        [InlineData("ut")]
        [InlineData("cap.Ut")]
        [InlineData("capture.Ut")]
        [InlineData("observation.SampledAtUt")]
        [InlineData("host.NowUt()")]
        [InlineData("snapshot.Ut")]
        [InlineData("nowUt.Value")]
        [InlineData("raw?.Ut ?? host.NowUt()")]
        public void EverySpellingTheTreeUsesIsAccepted(string stamp) =>
            Assert.True(NamesATime(stamp), stamp + " is a universe time and must be accepted");

        /// <summary>
        /// Whether an argument expression names a universe time: its final
        /// member is a <c>Ut</c>-suffixed identifier (<c>ut</c>, <c>cap.Ut</c>,
        /// <c>observation.SampledAtUt</c>, <c>host.NowUt()</c>,
        /// <c>nowUt.Value</c>).
        ///
        /// <para>A numeric literal is NOT one, standing alone or behind a
        /// <c>??</c>: a site with nothing to report reads the game clock and
        /// publishes nothing when it has none, so there is no honest use of a
        /// constant left to allow for.</para>
        /// </summary>
        internal static bool NamesATime(string stamp)
        {
            // A null-coalesced fallback is a stamp of its own; both halves have
            // to name a time, so check them separately rather than reading only
            // the one that happens to be last. A literal behind a ?? is a site
            // that HAD an instant on the good path and fabricated one on the
            // other.
            var index = stamp.IndexOf("??", StringComparison.Ordinal);
            if (index >= 0)
            {
                return NamesATime(stamp.Substring(0, index).Trim())
                    && NamesATime(stamp.Substring(index + 2).Trim());
            }

            var expression = stamp.Trim().TrimEnd('!');
            if (expression.Length == 0 || IsNumericLiteral(expression))
            {
                return false;
            }

            // `.Value` on a nullable is the same value under a different
            // spelling, so it is read through to what it unwraps: a site that
            // resolved its own absence and hands over the instant it DID read
            // must not be judged as if it had named something else, or the
            // reading that does the honest thing is the one that fails.
            // `.GetValueOrDefault()` is deliberately not read through, being
            // the substitution this whole scan exists to catch.
            if (expression.EndsWith(".Value", StringComparison.Ordinal))
            {
                expression = expression.Substring(0, expression.Length - ".Value".Length);
            }

            // The final member is what the expression evaluates to, so it is the
            // only part that can be asked what the value IS: cap.Roster.Count
            // and cap.Roster.Ut differ nowhere else.
            var last = expression.Split('.').Last().Trim();
            last = last.TrimEnd('!', '?');
            if (last.EndsWith("()", StringComparison.Ordinal))
            {
                last = last.Substring(0, last.Length - 2);
            }

            return last.EndsWith("Ut", StringComparison.Ordinal)
                || last.Equals("ut", StringComparison.Ordinal);
        }

        /// <summary>A bare numeric constant, suffix and all: <c>0</c>, <c>0.0</c>, <c>1.5d</c>.</summary>
        private static bool IsNumericLiteral(string expression) =>
            double.TryParse(
                expression.Trim().TrimEnd('!').TrimEnd('d', 'D', 'f', 'F', 'm', 'M'),
                System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture,
                out _);

        /// <summary>One <c>.Publish(</c> call site and the stamp it hands over.</summary>
        internal sealed class PublishSite
        {
            public PublishSite(string file, string stamp)
            {
                File = file;
                Stamp = stamp;
            }

            public string File { get; }

            public string Stamp { get; }
        }

        /// <summary>
        /// Every production <c>.Publish(</c> call site under <c>mod/</c>, with
        /// its LAST argument. Last rather than second because the engine's own
        /// publisher forwards through a three-argument overload, and the stamp
        /// is the trailing parameter of both.
        /// </summary>
        internal static List<PublishSite> PublishSites(string modDir)
        {
            var sites = new List<PublishSite>();
            foreach (var source in ProducerFlattenScan.ProductionSources(modDir))
            {
                var text = source.Text;
                var search = 0;
                while (true)
                {
                    var call = text.IndexOf(".Publish(", search, StringComparison.Ordinal);
                    if (call < 0)
                    {
                        break;
                    }

                    search = call + 1;
                    var open = call + ".Publish".Length;
                    var arguments = SplitArguments(text, open);
                    if (arguments.Count < 2)
                    {
                        continue;
                    }

                    sites.Add(new PublishSite(
                        source.Path,
                        string.Join(" ", arguments[arguments.Count - 1].Split(
                            (char[]?)null, StringSplitOptions.RemoveEmptyEntries))));
                }
            }
            return sites;
        }

        /// <summary>
        /// The top-level arguments of the call whose open paren is at
        /// <paramref name="open"/>. Nesting, string and char literals and
        /// comments are tracked, because a payload built inline can carry both a
        /// brace and a comma and either would otherwise split an argument in the
        /// wrong place.
        /// </summary>
        private static List<string> SplitArguments(string text, int open)
        {
            var arguments = new List<string>();
            var depth = 0;
            var start = open + 1;
            for (var i = open; i < text.Length; i++)
            {
                var c = text[i];
                switch (c)
                {
                    case '(':
                    case '[':
                    case '{':
                        depth++;
                        break;
                    case ')':
                    case ']':
                    case '}':
                        depth--;
                        if (depth == 0)
                        {
                            arguments.Add(text.Substring(start, i - start));
                            return arguments;
                        }
                        break;
                    case '"':
                        i = SkipString(text, i);
                        break;
                    case '\'':
                        i = SkipChar(text, i);
                        break;
                    case '/':
                        i = SkipComment(text, i);
                        break;
                    case ',':
                        if (depth == 1)
                        {
                            arguments.Add(text.Substring(start, i - start));
                            start = i + 1;
                        }
                        break;
                }
            }
            return arguments;
        }

        /// <summary>Index of the closing quote, verbatim strings included.</summary>
        private static int SkipString(string text, int quote)
        {
            var verbatim = quote > 0 && text[quote - 1] == '@';
            for (var i = quote + 1; i < text.Length; i++)
            {
                if (!verbatim && text[i] == '\\')
                {
                    i++;
                    continue;
                }
                if (text[i] != '"')
                {
                    continue;
                }
                if (verbatim && i + 1 < text.Length && text[i + 1] == '"')
                {
                    i++;
                    continue;
                }
                return i;
            }
            return text.Length;
        }

        private static int SkipChar(string text, int quote)
        {
            for (var i = quote + 1; i < text.Length; i++)
            {
                if (text[i] == '\\')
                {
                    i++;
                    continue;
                }
                if (text[i] == '\'')
                {
                    return i;
                }
            }
            return text.Length;
        }

        /// <summary>Index of the last character of a comment starting at
        /// <paramref name="slash"/>, or <paramref name="slash"/> itself when this
        /// is a division.</summary>
        private static int SkipComment(string text, int slash)
        {
            if (slash + 1 >= text.Length)
            {
                return slash;
            }

            if (text[slash + 1] == '/')
            {
                var end = text.IndexOf('\n', slash);
                return end < 0 ? text.Length : end;
            }

            if (text[slash + 1] == '*')
            {
                var end = text.IndexOf("*/", slash + 2, StringComparison.Ordinal);
                return end < 0 ? text.Length : end + 1;
            }

            return slash;
        }
    }
}
