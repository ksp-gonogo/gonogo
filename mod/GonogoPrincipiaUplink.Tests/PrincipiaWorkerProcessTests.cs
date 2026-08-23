using System;
using System.Collections.Generic;
using GonogoPrincipiaUplink;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// Talking to a worker. The replies here are the ones the real worker produced
    /// against the real Principia build on the rig, copied rather than invented.
    /// </summary>
    public class PrincipiaWorkerProcessTests
    {
        private sealed class ScriptedChannel : IPrincipiaWorkerChannel
        {
            private readonly string? _reply;
            public readonly List<string> Sent = new List<string>();
            public bool Disposed;
            public Exception? Throw;

            public ScriptedChannel(string? reply) => _reply = reply;

            public string? Exchange(string request)
            {
                Sent.Add(request);
                if (Throw != null)
                {
                    throw Throw;
                }
                return _reply;
            }

            public void Dispose() => Disposed = true;
        }

        /// <summary>Verbatim from the worker, run against the Deck's own
        /// x64_AVX_FMA build.</summary>
        private const string RigReply = "{\"ok\": true, \"hasAvx\": true, \"hasFma\": true}";

        [Fact]
        public void ReadsTheFmaBitOutOfTheWorkersOwnAnswer()
        {
            var channel = new ScriptedChannel(RigReply);

            var facts = PrincipiaWorkerProcess.AskCpuidFeatureFlags(
                channel, "/ksp/principia.so", "linux");

            Assert.Equal(true, facts.HasFma);
            Assert.Equal("linux", facts.OsFamily);
            Assert.True(facts.Known);
        }

        [Fact]
        public void AsksAboutTheBuildItWasGivenRatherThanAFixedPath()
        {
            // The worker loads whatever it is told to. Asking about the wrong file
            // would answer about a build the game is not running, and the answer
            // would look exactly as authoritative.
            var channel = new ScriptedChannel(RigReply);

            PrincipiaWorkerProcess.AskCpuidFeatureFlags(
                channel, "/ksp/GameData/Principia/Linux/x64/principia.so", "linux");

            Assert.Contains("x64/principia.so", channel.Sent[0]);
        }

        [Fact]
        public void AWorkerThatDiedIsUnknownRatherThanACpuWithoutFma()
        {
            // The distinction that matters. False is a CLAIM about the machine, and
            // it would let a decision proceed on the belief that the worker matches
            // a game host nobody measured.
            var channel = new ScriptedChannel(RigReply) { Throw = new InvalidOperationException("pipe closed") };

            var facts = PrincipiaWorkerProcess.AskCpuidFeatureFlags(
                channel, "/ksp/principia.so", "linux");

            Assert.Null(facts.HasFma);
            Assert.False(facts.Known);
        }

        [Fact]
        public void ARefusalFromTheWorkerIsUnknownAndNotFalse()
        {
            // What the worker really says when handed a build it cannot load: this
            // is the reply it produced on an arm64 Mac against an x86-64 build.
            var channel = new ScriptedChannel(
                "{\"ok\": false, \"reason\": \"The build could not be loaded: incompatible architecture\"}");

            var facts = PrincipiaWorkerProcess.AskCpuidFeatureFlags(
                channel, "/ksp/principia.so", "macos");

            Assert.Null(facts.HasFma);
        }

        [Fact]
        public void DoesNotTrustAValueThatCameBackWithAFailure()
        {
            // Found by mutation: the ok flag looked redundant because the worker's
            // own failure replies carry no flags to misread. It is not redundant, it
            // is defence against one that does. A reply saying the call failed while
            // still carrying a value is exactly the shape to refuse, because the
            // value is then left over from something other than the question asked.
            var channel = new ScriptedChannel("{\"ok\": false, \"hasFma\": true}");

            var facts = PrincipiaWorkerProcess.AskCpuidFeatureFlags(
                channel, "/ksp/principia.so", "linux");

            Assert.Null(facts.HasFma);
        }

        [Fact]
        public void NoChannelIsUnknownRatherThanAThrow()
        {
            var facts = PrincipiaWorkerProcess.AskCpuidFeatureFlags(null, "/p.so", "linux");

            Assert.Null(facts.HasFma);
        }

        [Fact]
        public void ReadsFalseAsFalseAndGarbageAsUnknown()
        {
            // A machine genuinely without FMA is a real answer and must not be
            // rounded to unknown, or a valid worker on an old CPU would be refused
            // forever.
            Assert.Equal(false, PrincipiaWorkerProcess.BoolField("{\"hasFma\": false}", "hasFma"));
            Assert.Equal(true, PrincipiaWorkerProcess.BoolField("{\"hasFma\": true}", "hasFma"));
            Assert.Null(PrincipiaWorkerProcess.BoolField("{\"hasFma\": \"yes\"}", "hasFma"));
            Assert.Null(PrincipiaWorkerProcess.BoolField("{}", "hasFma"));
            Assert.Null(PrincipiaWorkerProcess.BoolField(null, "hasFma"));
        }

        [Fact]
        public void TheWorkersAnswerIsWhatTheDecisionNeeded()
        {
            // The join. `Decide` refuses when the GAME HOST's facts are unknown, and
            // nothing in-process could establish them: reading CPUID where the
            // deciding code runs answers about the wrong machine. A worker ON the
            // game host is the one place the question can be asked honestly.
            var facts = PrincipiaWorkerProcess.AskCpuidFeatureFlags(
                new ScriptedChannel(RigReply), "/ksp/principia.so", "linux");

            var decision = PrincipiaWorkerHost.Decide(
                PrincipiaConformanceVerdict.Conformant(
                    PrincipiaBinaryVariant.X64AvxFma, "/ksp/principia.so", "abc", "Levi-Civita", 170),
                facts,
                facts,
                usesCorrectSinCos: true);

            Assert.True(decision.MayRun);
            Assert.Equal(PrincipiaNumericsProvenance.Reproduced, decision.Provenance);
        }

        [Fact]
        public void SpawningSaysNoRatherThanThrowingWhenThereIsNoWorkerScript()
        {
            // A machine without python, or a GameData without the script, is a
            // reason to do without the fidelity tier rather than a reason for the
            // Uplink to fail.
            Assert.Null(PrincipiaWorkerProcess.Spawn("python3", "/no/such/worker.py"));
        }
    }
}
