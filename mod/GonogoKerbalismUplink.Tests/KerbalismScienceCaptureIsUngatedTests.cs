using System;
using System.IO;
using System.Text.RegularExpressions;
using Xunit;

namespace GonogoKerbalismUplink.Tests
{
    /*
     * A SOURCE assertion, and it says so rather than pretending otherwise.
     *
     * The thing worth guarding is behavioural: the science capture must run on
     * every tick, because its Courier handler stashes the bundle that the five
     * File Manager verbs read as their pre-filter, and a skipped capture leaves
     * those verbs refusing with ModeUnavailable about an install that models
     * science. A behavioural case cannot reach it. `KerbalismUplink.Register`
     * reads `FlightGlobals` and this Tests project compiles a curated file list
     * that deliberately excludes the KSP-touching half, so nothing here can
     * drive the registration.
     *
     * So this reads the registration instead. It is weaker than driving it, and
     * the failure it CAN express is the one that actually happened: somebody
     * adding a topic prefix back to that call for the per-tick cost, without
     * noticing the handler's effect escapes the publish path.
     */
    public class KerbalismScienceCaptureIsUngatedTests
    {
        private static string Source()
        {
            // Walk up to the repo root rather than assuming a build layout: the
            // test binary's depth under bin/ differs between local and CI runs.
            var dir = AppContext.BaseDirectory;
            for (var i = 0; i < 10 && dir != null; i++)
            {
                var candidate = Path.Combine(
                    dir, "mod", "GonogoKerbalismUplink", "KerbalismUplink.cs");
                if (File.Exists(candidate)) return File.ReadAllText(candidate);
                dir = Path.GetDirectoryName(dir);
            }
            throw new InvalidOperationException(
                "KerbalismUplink.cs not found walking up from " + AppContext.BaseDirectory
                + ". This guard cannot see its subject, which reads the same as a pass, "
                + "so it fails instead.");
        }

        [Fact]
        public void TheScienceCaptureIsRegisteredWithNoSubscriptionPrefix()
        {
            var call = Regex.Match(
                Source(),
                @"AddSampledSource\(\s*CaptureScienceOnMain\s*,\s*HandleScienceOnCourier\s*(?<rest>[^)]*)\)");

            Assert.True(call.Success,
                "The science AddSampledSource call was not found at all. Either it was "
                + "renamed or removed; either way this guard is no longer watching what "
                + "it claims to watch.");

            Assert.True(
                string.IsNullOrWhiteSpace(call.Groups["rest"].Value),
                "The Kerbalism science capture has been given a subscription prefix: "
                + call.Value
                + ". A gated capture is skipped on any tick where nothing under its "
                + "prefixes is watched, and this one's handler stashes the bundle the "
                + "five File Manager verbs read. Gated, an unwatched session leaves that "
                + "stash empty and every verb refuses with ModeUnavailable, which says "
                + "Kerbalism is not modelling science about an install that is.");
        }

        [Fact]
        public void TheGuardCanTellAGatedCallFromAnUngatedOne()
        {
            /*
             * The control. A guard that matched nothing would pass the assertion
             * above by finding an empty `rest`, so the pattern is exercised here
             * against both spellings before its verdict on the real file is
             * trusted.
             */
            var pattern = new Regex(
                @"AddSampledSource\(\s*CaptureScienceOnMain\s*,\s*HandleScienceOnCourier\s*(?<rest>[^)]*)\)");

            var ungated = pattern.Match(
                "host.AddSampledSource(CaptureScienceOnMain, HandleScienceOnCourier);");
            Assert.True(ungated.Success);
            Assert.True(string.IsNullOrWhiteSpace(ungated.Groups["rest"].Value));

            var gated = pattern.Match(
                "host.AddSampledSource(CaptureScienceOnMain, HandleScienceOnCourier, \"science.\");");
            Assert.True(gated.Success);
            Assert.False(string.IsNullOrWhiteSpace(gated.Groups["rest"].Value));
        }
    }
}
