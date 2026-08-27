using System;
using System.IO;
using Gonogo.DevTools;
using Xunit;

namespace Gonogo.KSP.Tests.DevTools
{
    /// <summary>
    /// That <c>GonogoDevAntenna</c> reports the transience of its own boost, and does
    /// something about it.
    ///
    /// <para><b>The failure this covers.</b> The boost is a set of KSPField writes on a
    /// live <c>ModuleRealAntenna</c>, and reloading the vessel re-instantiates that
    /// module from the save, so the boost vanishes with no announcement. On 2026-08-27
    /// that silently returned a craft to unroutable mid-session and made a delay run
    /// unreadable, because a lapsed boost and a boost that never worked produce the same
    /// unroutable craft.</para>
    /// </summary>
    public class AntennaProbeVerdictsTests
    {
        private const double VerifyInterval = 5.0;

        [Fact]
        public void A_standing_boost_that_has_never_reverted_is_named_holding_with_its_cadence()
        {
            // The cadence is in the answer because "it has not reverted" is only worth
            // anything alongside how often anybody looked.
            var state = AntennaProbeVerdicts.BoostState(
                standing: true, lapsesThisRequest: 0, reassertions: 0, verifyIntervalSeconds: VerifyInterval);

            Assert.Contains("HOLDING", state);
            Assert.Contains("5s", state);
        }

        [Fact]
        public void A_boost_that_reverted_is_named_lapsed_and_says_the_reading_is_suspect()
        {
            var state = AntennaProbeVerdicts.BoostState(
                standing: true, lapsesThisRequest: 1, reassertions: 1, verifyIntervalSeconds: VerifyInterval);

            Assert.Contains("LAPSED", state);
            Assert.Contains("suspect", state);
        }

        [Fact]
        public void A_boost_reverted_before_this_requests_watch_began_still_reports_lapsed()
        {
            // Re-assertions are counted per craft and lapses per request. A request that
            // happened to miss a revert has no business calling the boost sound: the
            // transience is a property of the craft's session, not of one request.
            var state = AntennaProbeVerdicts.BoostState(
                standing: true, lapsesThisRequest: 0, reassertions: 3, verifyIntervalSeconds: VerifyInterval);

            Assert.Contains("LAPSED", state);
            Assert.Contains("3 time(s)", state);
        }

        [Fact]
        public void A_boost_that_does_not_stand_is_NOT_WATCHED_rather_than_holding()
        {
            // A refused request, or one that parsed and changed nothing, applies no
            // standing boost, so nothing re-asserts it. Reporting that as HOLDING would
            // be the tool claiming to guard something it is not.
            var state = AntennaProbeVerdicts.BoostState(
                standing: false, lapsesThisRequest: 0, reassertions: 0, verifyIntervalSeconds: VerifyInterval);

            Assert.Contains("NOT WATCHED", state);
            Assert.DoesNotContain("HOLDING", state);
        }

        [Fact]
        public void An_unstatable_verify_cadence_says_so_rather_than_printing_a_zero()
        {
            // "checked every 0s" would read as a tighter guarantee than any real one.
            var state = AntennaProbeVerdicts.BoostState(
                standing: true, lapsesThisRequest: 0, reassertions: 0, verifyIntervalSeconds: 0.0);

            Assert.Contains("unreadable interval", state);
            Assert.DoesNotContain("every 0s", state);
        }

        private static string Addon() => ReadModSource(Path.Combine("GonogoDevTools", "GonogoDevAntenna.cs"));

        [Fact]
        public void The_verify_pass_is_actually_driven_from_Update()
        {
            // The verdict is worth nothing if nothing is checking. This is the one link
            // in the chain that a refactor could drop while leaving the result file
            // still cheerfully printing HOLDING.
            Assert.Contains("VerifyStandingBoosts();", Addon(), StringComparison.Ordinal);
        }

        [Fact]
        public void Only_a_successful_request_leaves_a_standing_boost()
        {
            // Re-asserting values that changed nothing would turn one silent no-op into
            // a recurring one, and NOT WATCHED is the honest answer for it.
            var source = Addon();
            var okGateAt = source.IndexOf("if (watch.Ok)", StringComparison.Ordinal);
            var registerAt = source.IndexOf("StandingBoosts[watch.VesselId] = request;", StringComparison.Ordinal);

            Assert.True(okGateAt >= 0, "the ok gate this check anchors on is gone");
            Assert.True(registerAt > okGateAt, "a standing boost is no longer registered behind the ok gate");
            Assert.True(registerAt - okGateAt < 600, "the ok gate and the registration have drifted apart");
        }

        [Fact]
        public void A_lapse_is_logged_before_it_is_written_anywhere()
        {
            // The result file is only rewritten for the request the lapse belongs to, so
            // the log is the channel that always fires. If the warning ever moved after
            // the re-apply, a re-apply that threw would take the only notice with it.
            var source = Addon();
            var warnAt = source.IndexOf("boost LAPSED on", StringComparison.Ordinal);
            var reapplyAt = source.IndexOf("fault = Append(fault, WriteFields(module, request));", StringComparison.Ordinal);

            Assert.True(warnAt >= 0, "the lapse warning is gone");
            Assert.True(reapplyAt > warnAt, "the lapse is now re-applied before it is announced");
        }

        [Fact]
        public void An_unloaded_vessel_is_skipped_rather_than_reported_as_lapsed()
        {
            // Its ModuleRealAntenna instances do not exist, so there is nothing to
            // compare and nothing to write to. Calling that a lapse would invent a
            // finding out of an absence.
            Assert.Contains("if (vessel == null || !vessel.loaded)", Addon(), StringComparison.Ordinal);
        }

        [Fact]
        public void The_revert_check_compares_the_RealAntenna_side_and_not_only_the_module_fields()
        {
            // Precompute reads the RealAntenna, not the KSPField. A module field that
            // survived while the object behind it reverted is still a lapsed boost, and
            // that asymmetry is the whole reason the recalculation call exists.
            Assert.Contains("snapshot.RaTxPower", Addon(), StringComparison.Ordinal);
        }

        private static string ReadModSource(string relativePath)
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                var candidate = Path.Combine(dir.FullName, "mod", relativePath);
                if (File.Exists(candidate))
                {
                    return File.ReadAllText(candidate);
                }
                dir = dir.Parent;
            }

            throw new FileNotFoundException(
                "Could not locate mod/" + relativePath + " from " + AppContext.BaseDirectory);
        }
    }
}
