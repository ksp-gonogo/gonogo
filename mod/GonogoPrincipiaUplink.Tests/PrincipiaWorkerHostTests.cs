using System;
using GonogoPrincipiaUplink;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// Whether a second Principia may run beside the game, and what its answers are
    /// entitled to claim. The failure this guards is not a crash: it is a worker that
    /// runs, produces plausible numbers, and labels them as the game's when they are
    /// not.
    /// </summary>
    public class PrincipiaWorkerHostTests
    {
        private static PrincipiaConformanceVerdict Vetted() =>
            PrincipiaConformanceVerdict.Conformant(
                PrincipiaBinaryVariant.X64AvxFma, "/p/principia.so", "abc", "Levi-Civita", 170);

        private static readonly PrincipiaHostFacts Deck = new PrincipiaHostFacts("linux", true);

        [Fact]
        public void TheGameHostRunningItsOwnBuildIsReproduction()
        {
            // The intended arrangement: the worker beside the game, same machine.
            var decision = PrincipiaWorkerHost.Decide(Vetted(), Deck, Deck, usesCorrectSinCos: true);

            Assert.True(decision.MayRun);
            Assert.Equal(PrincipiaNumericsProvenance.Reproduced, decision.Provenance);
        }

        [Fact]
        public void ADifferentOperatingSystemIsAnEstimateAndSaysSo()
        {
            var mac = new PrincipiaHostFacts("macos", true);

            var decision = PrincipiaWorkerHost.Decide(Vetted(), Deck, mac, usesCorrectSinCos: true);

            Assert.True(decision.MayRun);
            Assert.Equal(PrincipiaNumericsProvenance.IndependentEstimate, decision.Provenance);
        }

        [Fact]
        public void ADifferentFmaBitIsAnEstimateEvenOnTheSameOperatingSystem()
        {
            // Principia's loader dispatches on this one bit, so a worker without FMA
            // runs a different numeric path from a game host with it. Same OS, same
            // file, different arithmetic.
            var noFma = new PrincipiaHostFacts("linux", false);

            var decision = PrincipiaWorkerHost.Decide(Vetted(), Deck, noFma, usesCorrectSinCos: true);

            Assert.True(decision.MayRun);
            Assert.Equal(PrincipiaNumericsProvenance.IndependentEstimate, decision.Provenance);
        }

        [Fact]
        public void RefusesWhenTheSavesTrigComesFromALibraryTheWorkerDoesNotShare()
        {
            // With the flag false the trig is the platform's libm, which is not in the
            // borrowed file. There is nothing here to reproduce WITH, so this refuses
            // rather than offering an estimate beside numbers that are the game's.
            var mac = new PrincipiaHostFacts("macos", true);

            var decision = PrincipiaWorkerHost.Decide(Vetted(), Deck, mac, usesCorrectSinCos: false);

            Assert.False(decision.MayRun);
            Assert.Equal(PrincipiaWorkerRefusal.TrigNotBorrowable, decision.Refusal);
        }

        [Fact]
        public void ThePlatformsOwnTrigStillReproducesOnThatSamePlatform()
        {
            // The complement of the case above, and easy to get wrong by treating the
            // flag as bad news. False means libm; on the same OS that is the same
            // libm, so it reproduces.
            var decision = PrincipiaWorkerHost.Decide(Vetted(), Deck, Deck, usesCorrectSinCos: false);

            Assert.True(decision.MayRun);
            Assert.Equal(PrincipiaNumericsProvenance.Reproduced, decision.Provenance);
        }

        [Fact]
        public void AnUnreadTrigFlagIsItsOwnAnswerRatherThanADowngrade()
        {
            // Everything matched except one unread bit. Calling that an independent
            // estimate would tell an operator far less than is actually known.
            var decision = PrincipiaWorkerHost.Decide(Vetted(), Deck, Deck, usesCorrectSinCos: null);

            Assert.True(decision.MayRun);
            Assert.Equal(PrincipiaNumericsProvenance.ReproducedExceptTrig, decision.Provenance);
        }

        [Fact]
        public void RefusesEverythingWhenTheBuildDidNotPassTheGate()
        {
            var unknown = PrincipiaConformanceVerdict.Unknown(
                PrincipiaBinaryVariant.X64, "/p/principia.so", "deadbeef", 170);

            var decision = PrincipiaWorkerHost.Decide(unknown, Deck, Deck, usesCorrectSinCos: true);

            Assert.False(decision.MayRun);
            Assert.Equal(PrincipiaWorkerRefusal.BuildNotConformant, decision.Refusal);
        }

        [Fact]
        public void RefusesWhenTheGAMEHOSTSOwnFactsAreUnknown()
        {
            // The trap this exists for. The tempting implementation reads the FMA bit
            // locally, which succeeds and answers a different question: whether the
            // WORKER has FMA, when what was asked is whether it matches the game. A
            // mismatch then becomes invisible rather than loud.
            var unknownHost = new PrincipiaHostFacts(null, null);

            var decision = PrincipiaWorkerHost.Decide(Vetted(), unknownHost, Deck, usesCorrectSinCos: true);

            Assert.False(decision.MayRun);
            Assert.Equal(PrincipiaWorkerRefusal.GameHostUnknown, decision.Refusal);
            Assert.Contains("never on the worker", decision.Reason, StringComparison.OrdinalIgnoreCase);
        }

        [Fact]
        public void AGameHostWithNoFmaBitReadIsNotAGameHostWithoutFma()
        {
            // Null and false are different facts and the second is a claim. Treating
            // "not read" as "absent" would have a worker on an FMA machine believe it
            // matched a game host nobody measured.
            var halfKnown = new PrincipiaHostFacts("linux", null);

            var decision = PrincipiaWorkerHost.Decide(Vetted(), halfKnown, Deck, usesCorrectSinCos: true);

            Assert.False(decision.MayRun);
            Assert.Equal(PrincipiaWorkerRefusal.GameHostUnknown, decision.Refusal);
        }

        [Fact]
        public void ADefaultDecisionRunsNothingAndClaimsNothing()
        {
            var untouched = default(PrincipiaWorkerDecision);

            Assert.False(untouched.MayRun);
            Assert.Equal(PrincipiaNumericsProvenance.NotEstablished, untouched.Provenance);
        }
    }
}
