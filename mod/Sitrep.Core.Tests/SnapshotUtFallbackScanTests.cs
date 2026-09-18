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
    /// <para><b>The whole tree is held to zero, with no debt list.</b> It was
    /// briefly a ceiling, because the live-clock form differs on either side of
    /// the Uplink boundary: core substitutes
    /// <c>Planetarium.GetUniversalTime()</c>, and an Uplink cannot, its test
    /// project compiling its sources with no KSP assemblies. The seam that does
    /// work there is <c>IUplinkHost.NowUt</c>, reached through a per-class
    /// <c>UtOf</c> helper off a host held from <c>Register</c>, and the reason it
    /// could not be taken sooner was that those test projects registered no host
    /// and had no host double to register. A public clock-carrying double in
    /// <c>Sitrep.Contract.TestSupport</c> removed the obstacle, so both forms are
    /// now accepted and every capture in the tree takes one of them.</para>
    ///
    /// <para>This file deliberately names no Uplink. A core test that hardcoded
    /// Uplink paths would itself trip <c>uplink-boundary</c>, which is the gate
    /// that keeps core from reaching into an Uplink, so it reads every production
    /// source and asks the same question of all of them.</para>
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

        /// <summary>
        /// The live-clock form(s) the guard may take. Held as text rather than as
        /// paths so the assertion below can say the guard is still PRESENT without
        /// naming a project.
        ///
        /// <para>Core's own <c>Planetarium.GetUniversalTime()</c> form is the only
        /// one this tree still contains an example of. The Uplink-side form,
        /// <c>snapshot?.Ut ?? _host!.NowUt()</c>, is equally valid and
        /// <see cref="EpochFallback"/> treats the two alike, matching only a bare
        /// numeric literal and never a call. So this list is what the scan can find
        /// here, not what the guard accepts.</para>
        /// </summary>
        private static readonly string[] AcceptedForms =
        {
            "snapshot?.Ut ?? Planetarium.GetUniversalTime()",
        };

        [Fact]
        public void NoCaptureFallsBackToTheEpochForItsInstant()
        {
            var offenders = Offenders();

            Assert.True(
                offenders.Count == 0,
                "A capture with no snapshot must take the live clock, not the epoch. Year 1 day 1 is "
                    + "a real instant, so these stamp a reading with a time nobody measured. The fix "
                    + "is snapshot?.Ut ?? Planetarium.GetUniversalTime() in core, and the same guard "
                    + "over IUplinkHost.NowUt in an Uplink, which cannot reach Planetarium:\n  "
                    + string.Join("\n  ", offenders));
        }

        /// <summary>
        /// The scan can SEE the thing it forbids.
        ///
        /// <para>A counter that cannot see a violation reports zero, and zero
        /// reads as success. The tree is at zero on purpose, so without this the
        /// test would pass just as happily if the pattern stopped matching, which
        /// it would on any reformatting of the guard. It plants each spelling and
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

            foreach (var text in AcceptedForms)
            {
                Assert.False(
                    EpochFallback.IsMatch("private double UtOf(KspSnapshot? snapshot) => " + text + ";"),
                    "The scan now rejects a live-clock form it must accept: " + text);
            }
        }

        /// <summary>
        /// The scan is reading the real tree, not an empty walk.
        ///
        /// <para>Its sibling above proves the pattern matches; this proves there is
        /// something to match against. <c>ProductionSources</c> throws on an empty
        /// walk, and every form in <see cref="AcceptedForms"/> must still be
        /// present, or the property being ratcheted has quietly stopped existing.
        /// Core's <c>Planetarium.GetUniversalTime()</c> form is the only one left to
        /// check: see <see cref="AcceptedForms"/>'s own doc comment for why the
        /// Uplink-side form dropped out of this list rather than this scan simply
        /// failing to see it.</para>
        /// </summary>
        [Fact]
        public void TheGuardStillExistsInItsAcceptedForm()
        {
            var sources = ProducerFlattenScan.ProductionSources(
                ProducerFieldParityTests.ResolveModDir());

            foreach (var form in AcceptedForms)
            {
                Assert.True(
                    sources.Any(s => s.Text.Contains(form, StringComparison.Ordinal)),
                    "No production file guards snapshot?.Ut with " + form + " any more. Either the "
                        + "guard was removed wholesale, in which case this ratchet is obsolete and "
                        + "should go, or the scan has stopped reading the sources it thinks it reads.");
            }
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
