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
    /// <para><b>The defect this is the general form of.</b>
    /// <c>CommandCentreDelayUplink</c> published <c>commandCentre.roster</c>
    /// with <c>cap.Roster.Count</c> as its stamp: the NUMBER OF COMMAND CENTRES
    /// where a UT belongs. It went unnoticed for as long as it did because the
    /// engine's only sanity check on a caller-supplied stamp is a FORWARD clamp
    /// (see <c>ChannelEngine.ProcessPublish</c>): a stamp ahead of the clock is
    /// pulled back to now, and a stamp far BEHIND it (which a small count always
    /// is) is recorded exactly as given. So the sample landed stamped in
    /// the deep past with <c>validAt</c> on the wire equal to a centre count,
    /// and no test, no log line and no clamp said anything.</para>
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
        /// <summary>
        /// How few call sites would mean the scan has stopped seeing the tree
        /// rather than that the tree got smaller. Seventy-eight were found when
        /// this was written; a floor well under that survives ordinary churn
        /// while still failing a match pattern that quietly stops matching.
        /// </summary>
        private const int MinimumCallSites = 60;

        [Fact]
        public void EveryPublishIsStampedWithSomethingThatNamesATime()
        {
            var sites = PublishSites(ProducerFieldParityTests.ResolveModDir());

            Assert.True(
                sites.Count >= MinimumCallSites,
                "The publish scan found only " + sites.Count + " call sites (expected at least "
                    + MinimumCallSites + "). Either the mod shrank a great deal or the scan has "
                    + "stopped matching, and a scan that matches nothing reports a clean tree.");

            var offenders = sites.Where(site => !NamesATime(site.Stamp)).ToList();

            Assert.True(
                offenders.Count == 0,
                "Publish() takes a universe time as its LAST argument. These call sites hand it an "
                    + "expression that does not name one, and the engine will record the sample at "
                    + "whatever number it is, because its only check on a stamp is a forward clamp:\n  "
                    + string.Join("\n  ", offenders.Select(o => o.File + ": Publish(..., " + o.Stamp + ")")));
        }

        /// <summary>
        /// The check can SEE a bad stamp, planted in every shape the real defect
        /// could take. Without this the test would report a clean tree just as
        /// happily if <see cref="NamesATime"/> said yes to everything, which is
        /// the failure mode a scan is most prone to and least able to announce.
        /// </summary>
        [Theory]
        [InlineData("cap.Roster.Count")] // the defect as it actually shipped
        [InlineData("roster.Count")]
        [InlineData("entries.Length")]
        [InlineData("vessels.Count()")]
        [InlineData("index")]
        [InlineData("capture.VesselId")]
        public void AStampThatNamesSomethingElseIsRejected(string stamp) =>
            Assert.False(NamesATime(stamp), stamp + " is not a universe time and must be rejected");

        /// <summary>
        /// Every spelling the tree actually uses is accepted, so the gate cannot
        /// be satisfied by narrowing it until nothing passes.
        /// </summary>
        [Theory]
        [InlineData("ut")]
        [InlineData("cap.Ut")]
        [InlineData("capture.Ut")]
        [InlineData("raw?.Ut ?? 0.0")]
        [InlineData("observation.SampledAtUt")]
        [InlineData("host.NowUt()")]
        [InlineData("snapshot.Ut")]
        [InlineData("0.0")]
        public void EverySpellingTheTreeUsesIsAccepted(string stamp) =>
            Assert.True(NamesATime(stamp), stamp + " is a universe time and must be accepted");

        /// <summary>
        /// Whether an argument expression names a universe time: its final
        /// member is a <c>Ut</c>-suffixed identifier (<c>ut</c>, <c>cap.Ut</c>,
        /// <c>observation.SampledAtUt</c>, <c>host.NowUt()</c>), or it is a
        /// numeric literal, which is how the tree spells "before the first
        /// snapshot, so there is no time to quote".
        /// </summary>
        internal static bool NamesATime(string stamp)
        {
            // A null-coalesced fallback is a stamp of its own; both halves have
            // to name a time, so check them separately rather than reading only
            // the one that happens to be last.
            var index = stamp.IndexOf("??", StringComparison.Ordinal);
            if (index >= 0)
            {
                return NamesATime(stamp.Substring(0, index).Trim())
                    && NamesATime(stamp.Substring(index + 2).Trim());
            }

            var expression = stamp.Trim().TrimEnd('!');
            if (expression.Length == 0)
            {
                return false;
            }

            if (double.TryParse(
                    expression.TrimEnd('d', 'D', 'f', 'F', 'm', 'M'),
                    System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture,
                    out _))
            {
                return true;
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
