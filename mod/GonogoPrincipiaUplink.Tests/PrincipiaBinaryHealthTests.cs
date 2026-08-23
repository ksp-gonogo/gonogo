using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// What the gate's answer becomes on the roster, and the wiring that gets it
    /// there.
    ///
    /// <para>Every other gate test calls the gate directly, so all of them pass
    /// whether or not anything in the Uplink ever invokes it, which is how a gate
    /// ships inert. These are the tests that would notice.</para>
    ///
    /// <para>This file replaces the channel tests that stood here while the verdict
    /// rode a <c>principia.conformance</c> topic. Each of those claims is kept and
    /// re-aimed at where the fact now travels: the declaration test now asserts
    /// there is no such channel and that health carries the facts instead; the
    /// nothing-yet test drives the same capture; and the wire-shape test moved to
    /// <c>ChannelEngineTests.SystemUplinksReportsMixedSelfReportedAndDerivedHealth</c>,
    /// which exercises the real socket and now covers every uplink's facts rather
    /// than this one's. There is nothing left to assert about the shape HERE: a fact
    /// holds a string, so the POCO that took the whole uplink down in-game is no
    /// longer a thing this Uplink can hand over.</para>
    /// </summary>
    public class PrincipiaBinaryHealthTests
    {
        private static PrincipiaUplink Available() =>
            new PrincipiaUplink(PrincipiaGuardResult.Ok(new Version(2026, 8, 12, 25557)));

        private static PrincipiaConformanceVerdict AVettedBuild() =>
            PrincipiaConformanceVerdict.Conformant(
                PrincipiaBinaryVariant.X64AvxFma,
                "/GameData/Principia/Linux/x64_AVX_FMA/principia.so",
                "b2569d212a9fbbe5334e49ed05f08b464a4e387469231245e3f682f5c6ce11b3",
                "2026081218-Levi-Civita",
                170);

        private static PrincipiaWorkerDecision TheGamesOwnNumbers() =>
            PrincipiaWorkerDecision.Run(
                PrincipiaNumericsProvenance.Reproduced, "Same platform, same FMA support.");

        private static string? FactNamed(UplinkHealth health, string label) =>
            health.Facts.Single(f => f.Label == label).Value;

        [Fact]
        public void TheVerdictTravelsAsHealthRatherThanAsAChannelOfItsOwn()
        {
            // The claim the deleted `principia.conformance` declaration used to
            // carry: an operator's only view of whether their Principia is vetted is
            // this reaching them at all. It now reaches them on the roster, so the
            // absence of the channel and the presence of the facts are one claim and
            // are asserted together. Split apart, deleting the health report would
            // leave the channel assertion passing while nobody was told anything.
            var uplink = Available();

            Assert.DoesNotContain(
                uplink.Manifest.Channels, c => c.Topic == "principia.conformance");

            uplink.AdoptBinaryHealthOnCourier(
                PrincipiaBinaryHealth.Of(
                    new Version(2026, 8, 12, 25557), AVettedBuild(), TheGamesOwnNumbers()));

            var health = uplink.Health();
            Assert.Equal(
                "/GameData/Principia/Linux/x64_AVX_FMA/principia.so",
                FactNamed(health, "build"));
        }

        [Fact]
        public void RegisteringWiresTheGateToTheHealthReport()
        {
            // The gate is joined to the roster by a capture/handle pair, and nothing
            // else joins them: a Register that took the publisher and forgot the
            // source would leave every gate test passing and the operator told
            // "reading which build" forever.
            var uplink = Available();
            var host = new RecordingUplinkHost();

            uplink.Register(host);

            var source = Assert.Single(host.UngatedSampledSources);
            source.Handle(
                PrincipiaBinaryHealth.Of(null, AVettedBuild(), TheGamesOwnNumbers()));

            Assert.Equal("2026081218-Levi-Civita", FactNamed(uplink.Health(), "release"));
        }

        [Fact]
        public void TheGateIsNotSubscriptionGated()
        {
            // Registered with no topic prefixes on purpose. The roster is polled
            // whether or not a client has subscribed to anything of this Uplink's,
            // so a gate that only ran while somebody was watching a Principia
            // channel would leave the roster describing a build nobody had read.
            var uplink = Available();
            var host = new RecordingUplinkHost();

            uplink.Register(host);

            Assert.DoesNotContain("principia.conformance", host.SampledSourceTopics);
            Assert.Single(host.UngatedSampledSources);
        }

        [Fact]
        public void CapturingSaysNothingUntilThereIsAVerdictToGive()
        {
            // A read taken while Principia is still loading finds nothing mapped, and
            // that is not a verdict about the install. Answering here would latch
            // "Principia is not loaded" about a game that is about to load it, and
            // the once-only guard would make it permanent.
            var uplink = Available();

            Assert.Null(uplink.CaptureBinaryHealthOnMain(null));
        }

        [Fact]
        public void BeforeTheGateAnswersTheUplinkIsHealthyAndSaysWhatItIsDoing()
        {
            // Healthy, not degraded. The flight plan, the settings and the plan
            // mirror are read through the managed assembly and work whatever the
            // native gate later concludes, so reporting a problem here would attach
            // one to channels that have none.
            var health = Available().Health();

            Assert.Equal(UplinkHealthState.Healthy, health.State);
            Assert.Equal("2026.8.12.25557", FactNamed(health, "version"));
            Assert.NotNull(health.Detail);
        }

        [Fact]
        public void AnAbsentPrincipiaIsUnavailableAndCarriesNoFacts()
        {
            var uplink = new PrincipiaUplink(PrincipiaGuardResult.Fail("Principia not detected"));

            var health = uplink.Health();

            Assert.Equal(UplinkHealthState.Unavailable, health.State);
            Assert.Equal("Principia not detected", health.Detail);
            Assert.Empty(health.Facts);
        }

        [Fact]
        public void TheHandlerIsNotFedSomethingThatIsNotAReading()
        {
            // The courier hands back whatever the capture returned, including the
            // null a tick with no verdict returns.
            var uplink = Available();

            uplink.AdoptBinaryHealthOnCourier(null);
            uplink.AdoptBinaryHealthOnCourier("not a reading");

            Assert.Equal(UplinkHealthState.Healthy, uplink.Health().State);
        }

        [Fact]
        public void AVettedBuildIsHealthy()
        {
            var health = PrincipiaBinaryHealth
                .Of(null, AVettedBuild(), TheGamesOwnNumbers())
                .ToHealth();

            Assert.Equal(UplinkHealthState.Healthy, health.State);
        }

        [Fact]
        public void AnUnvettedReleaseIsDegradedRatherThanUnavailable()
        {
            // Degraded, because every channel this Uplink publishes still works: the
            // plan is read through the managed assembly and does not care what the
            // native gate said. Unavailable is the roster's word for an Uplink that
            // is not working, and using it here would hide a flight plan that is
            // being read correctly.
            var verdict = PrincipiaConformanceVerdict.Unknown(
                PrincipiaBinaryVariant.X64, "/GameData/Principia/x64/principia.so", "abc123", 170);

            var health = PrincipiaBinaryHealth
                .Of(null, verdict, PrincipiaWorkerHost.Decide(
                    verdict,
                    new PrincipiaHostFacts("linux", true),
                    new PrincipiaHostFacts("linux", true),
                    null))
                .ToHealth();

            Assert.Equal(UplinkHealthState.Degraded, health.State);
            Assert.Equal("abc123", FactNamed(health, "interface hash"));
        }

        [Fact]
        public void AnUnreadableBuildIsDegradedAndSaysWhy()
        {
            var verdict = PrincipiaConformanceVerdict.Refused(
                PrincipiaBinaryVariant.Unknown, "/GameData/Principia/x64/principia.so",
                null, 0, null, "The build embeds no interface descriptor.");

            var health = PrincipiaBinaryHealth
                .Of(null, verdict, PrincipiaWorkerHost.Decide(
                    verdict,
                    new PrincipiaHostFacts("linux", true),
                    new PrincipiaHostFacts("linux", true),
                    null))
                .ToHealth();

            Assert.Equal(UplinkHealthState.Degraded, health.State);
            Assert.Contains("no interface descriptor", health.Detail);
        }

        [Fact]
        public void EveryIdentityTheVerdictCarriesReachesTheRoster()
        {
            // The labels are pinned rather than merely counted, so a fact that is
            // renamed, dropped or added forces the decision to be made here instead
            // of quietly changing what an operator is asked to quote. The old channel
            // guarded the same thing by counting the flattened dictionary's keys
            // against the report type's properties.
            var health = PrincipiaBinaryHealth
                .Of(new Version(1, 2), AVettedBuild(), TheGamesOwnNumbers())
                .ToHealth();

            Assert.Equal(
                new[]
                {
                    "version", "build", "instruction set", "release",
                    "interface hash", "interface exports", "numerics",
                },
                health.Facts.Select(f => f.Label).ToArray());
            Assert.Equal("AVX+FMA", FactNamed(health, "instruction set"));
            Assert.Equal("170", FactNamed(health, "interface exports"));
            Assert.Contains("the game's own arithmetic", FactNamed(health, "numerics"));
        }

        [Fact]
        public void AWorkerThatMayNotRunSaysSoOnTheSameRowThatWouldHaveClaimed()
        {
            // The numerics row answers one question, "what would a trajectory
            // computed here be", and a refusal is an answer to it. Splitting the
            // claim and the refusal across two rows would leave one of them empty
            // every time and the operator scanning for which one is populated.
            var verdict = PrincipiaConformanceVerdict.Unknown(
                PrincipiaBinaryVariant.X64, "/p/principia.so", "abc123", 170);
            var refused = PrincipiaWorkerHost.Decide(
                verdict,
                new PrincipiaHostFacts("linux", true),
                new PrincipiaHostFacts("linux", true),
                null);

            var health = PrincipiaBinaryHealth.Of(null, verdict, refused).ToHealth();

            Assert.False(refused.MayRun);
            Assert.Equal(refused.Reason, FactNamed(health, "numerics"));
        }

        [Fact]
        public void AFactTheUplinkCouldNotEstablishIsNullRatherThanInvented()
        {
            // An unrecognised release has no build stamp to report, and an empty
            // string would render as a blank row an operator reads as "nothing".
            var verdict = PrincipiaConformanceVerdict.Unknown(
                PrincipiaBinaryVariant.X64, "/p/principia.so", "abc123", 170);

            var health = PrincipiaBinaryHealth
                .Of(null, verdict, PrincipiaWorkerDecision.Refuse(
                    PrincipiaWorkerRefusal.BuildNotConformant, "not vetted"))
                .ToHealth();

            Assert.Null(FactNamed(health, "release"));
        }
    }
}
