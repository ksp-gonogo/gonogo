using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Sitrep.Core.Tests
{
    /// <summary>
    /// A capture that runs without a snapshot must take the LIVE clock, never the
    /// epoch.
    ///
    /// <para><b>The defect this is the general form of.</b> Twenty-one sites
    /// guarded <c>snapshot?.Ut</c> and the guard was written two ways in one
    /// codebase: four fell back to the live clock and seventeen to <c>0.0</c>.
    /// Year 1 day 1 is a real instant, so a reading stamped with it does not say
    /// "the time is unknown", it says the reading is from the start of the game.
    /// None of the seventeen was reachable, because <c>GonogoAddon</c>
    /// dereferences <c>snapshot.Ut</c> before any Uplink sees the snapshot and a
    /// null NREs there first. That is exactly why they sat unnoticed: the wrong
    /// answer was invisible until something upstream made the branch live.</para>
    ///
    /// <para><b>Why a scan and not a behavioural test.</b> The branch cannot be
    /// entered today, so there is no behaviour to assert. What can be asserted is
    /// that the guard stays written ONE way, which is the property that was
    /// actually broken. A behavioural test would have to make the branch
    /// reachable first, and that is a change to the engine rather than to these
    /// call sites.</para>
    ///
    /// <para><b>Core is held to zero, an Uplink is held to a ceiling</b>, and the
    /// split is not laziness. In core the live-clock form is a one-word
    /// substitution, <c>Planetarium.GetUniversalTime()</c>, and every core site
    /// took it. An Uplink cannot: its test project compiles its sources with NO
    /// KSP assemblies, so that call does not even build there, and the seam that
    /// does work, <c>IUplinkHost.NowUt</c>, is null in precisely the case the
    /// guard exists for. Those Uplinks' own tests call their capture with no host
    /// registered and no host double to register, so reaching for the host there
    /// turns a silent wrong answer into a crash in the test suite. Fixing them
    /// means either giving those test projects a host double, or having the
    /// captures decline when they have no instant, which makes the raw UTs
    /// nullable and reaches the publish side too. That is a decision, tracked
    /// separately, and not something to guess at from inside a ratchet.</para>
    ///
    /// <para>This file deliberately names no Uplink. A core test that hardcoded
    /// Uplink paths would itself trip <c>uplink-boundary</c>, which is the gate
    /// that keeps core from reaching into an Uplink, so the debt is expressed as
    /// a directory shape and a count instead.</para>
    /// </summary>
    public class SnapshotUtFallbackScanTests
    {
        /// <summary>
        /// A <c>snapshot?.Ut</c> guard coalescing to a bare numeric literal.
        /// Matches <c>?? 0.0</c>, <c>?? 0</c>, <c>?? 0.0d</c> and the like, and
        /// does NOT match a call, so both live-clock forms pass.
        /// </summary>
        private static readonly Regex EpochFallback = new Regex(
            @"snapshot\s*\?\s*\.\s*Ut\s*\?\?\s*-?\d+(\.\d+)?[dfDF]?",
            RegexOptions.Compiled);

        /// <summary>Any file belonging to an Uplink project rather than to core.</summary>
        private static readonly Regex UplinkOwned = new Regex(
            @"^mod/Gonogo[A-Za-z0-9]*Uplink(\.[A-Za-z]+)?/",
            RegexOptions.Compiled);

        /// <summary>
        /// The Uplink sites still on the epoch form. SHRINK-ONLY: this number may
        /// go down and must never go up. Measured 2026-09-14, when core reached
        /// zero. See the class doc for what fixing these needs.
        /// </summary>
        private const int UplinkEpochFallbackCeiling = 12;

        [Fact]
        public void NoCoreCaptureFallsBackToTheEpochForItsInstant()
        {
            var offenders = Offenders().Where(o => !UplinkOwned.IsMatch(o)).ToList();

            Assert.True(
                offenders.Count == 0,
                "A capture with no snapshot must take the live clock, not the epoch. Year 1 day 1 is "
                    + "a real instant, so these stamp a reading with a time nobody measured. In core "
                    + "the fix is snapshot?.Ut ?? Planetarium.GetUniversalTime(), which is what every "
                    + "other core site does:\n  "
                    + string.Join("\n  ", offenders));
        }

        [Fact]
        public void TheUplinkEpochFallbackDebtDoesNotGrow()
        {
            var offenders = Offenders().Where(o => UplinkOwned.IsMatch(o)).ToList();

            Assert.True(
                offenders.Count <= UplinkEpochFallbackCeiling,
                "More Uplink captures fall back to the epoch than the recorded ceiling of "
                    + UplinkEpochFallbackCeiling + ". An Uplink cannot call Planetarium (its test "
                    + "project has no KSP assemblies) and cannot lean on IUplinkHost.NowUt while its "
                    + "tests register no host, so a new one here is a new wrong answer with no cheap "
                    + "fix. Found " + offenders.Count + ":\n  "
                    + string.Join("\n  ", offenders));

            // Reported, never failed on a DROP: the ceiling is a ceiling, and a
            // count that came in low wants tightening in the commit that earned
            // it rather than failing the run that noticed.
            if (offenders.Count < UplinkEpochFallbackCeiling)
            {
                Console.WriteLine(
                    "[snapshot-ut-fallback] Uplink epoch fallbacks down to " + offenders.Count
                        + " from a ceiling of " + UplinkEpochFallbackCeiling
                        + ". Tighten UplinkEpochFallbackCeiling in the same commit.");
            }
        }

        /// <summary>
        /// The scan can SEE the thing it forbids.
        ///
        /// <para>A counter that cannot see a violation reports zero, and zero
        /// reads as success. Core is at zero on purpose, so without this the test
        /// would pass just as happily if the pattern stopped matching, which it
        /// would on any reformatting of the guard. It plants each spelling and
        /// also asserts the accepted forms stay accepted, so a tightened regex
        /// that caught the live clock too fails here rather than sending someone
        /// hunting a phantom offender.</para>
        /// </summary>
        [Fact]
        public void TheScanCanSeeAnEpochFallbackAndLeavesTheLiveClockAlone()
        {
            var forbidden = new[]
            {
                "var ut = snapshot?.Ut ?? 0.0;",
                "Record(snapshot?.Ut ?? 0);",
                "var ut = snapshot ?. Ut ?? 0.0d;",
            };
            foreach (var text in forbidden)
            {
                Assert.True(
                    EpochFallback.IsMatch(text),
                    "The scan no longer matches an epoch fallback it must catch: " + text);
            }

            var accepted = new[]
            {
                "var ut = snapshot?.Ut ?? Planetarium.GetUniversalTime();",
                "private double UtOf(KspSnapshot? snapshot) => snapshot?.Ut ?? _host!.NowUt();",
            };
            foreach (var text in accepted)
            {
                Assert.False(
                    EpochFallback.IsMatch(text),
                    "The scan now rejects a live-clock form it must accept: " + text);
            }

            // And the core/Uplink split keys on a real directory shape.
            Assert.True(UplinkOwned.IsMatch("mod/GonogoSomethingUplink/Thing.cs"));
            Assert.True(UplinkOwned.IsMatch("mod/GonogoSomethingUplink.Contract/Thing.cs"));
            Assert.False(UplinkOwned.IsMatch("mod/Gonogo.KSP/Thing.cs"));
            Assert.False(UplinkOwned.IsMatch("mod/Sitrep.Host/Thing.cs"));
        }

        /// <summary>
        /// The scan is reading the real tree, not an empty walk.
        ///
        /// <para>Its sibling above proves the pattern matches; this proves there is
        /// something to match against. <c>ProductionSources</c> throws on an empty
        /// walk, and the guard must still be PRESENT in its accepted form, or the
        /// property being ratcheted has quietly stopped existing.</para>
        /// </summary>
        [Fact]
        public void TheGuardStillExistsInItsAcceptedForm()
        {
            var sources = ProducerFlattenScan.ProductionSources(
                ProducerFieldParityTests.ResolveModDir());

            var accepted = sources
                .Count(s => s.Text.Contains(
                    "snapshot?.Ut ?? Planetarium.GetUniversalTime()", StringComparison.Ordinal));

            Assert.True(
                accepted > 0,
                "No production file guards snapshot?.Ut with the live clock any more. Either the "
                    + "guard was removed wholesale, in which case this ratchet is obsolete and "
                    + "should go, or the scan has stopped reading the sources it thinks it reads.");
        }

        private static List<string> Offenders()
        {
            var sources = ProducerFlattenScan.ProductionSources(
                ProducerFieldParityTests.ResolveModDir());

            var offenders = new List<string>();
            foreach (var source in sources)
            {
                foreach (Match match in EpochFallback.Matches(source.Text))
                {
                    offenders.Add(source.Path + ": " + match.Value.Trim());
                }
            }

            return offenders;
        }
    }
}
