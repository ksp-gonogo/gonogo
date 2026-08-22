using System;
using System.Collections.Generic;
using System.Linq;
using GonogoPrincipiaUplink;
using Sitrep.Contract;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// What ELECTS each piece of the write surface, asserted against the production
    /// path rather than against a flag a test set.
    ///
    /// <para><b>Why this file exists as a separate kind of check.</b> A sibling
    /// slice of this same Uplink shipped with 2,336 green mod tests and could not
    /// execute at all: its gate tested <c>is IIntegratedTrajectorySource</c>,
    /// nothing implemented that interface, and every test of the component behind
    /// the gate opened the gate by hand. Each half was proved and the wiring between
    /// them was where it was broken. So the checks below assert only the wiring:
    /// that every declared command has a handler and every handler a declaration,
    /// that the name a client sends is the name the producer answers, that the write
    /// register and the port agree in both directions, and that the reflected bind
    /// really finds the producer's own method names.</para>
    ///
    /// <para>None of these constructs a plan or asserts a burn. That is the other
    /// file's job, and keeping them apart is deliberate: a test that does both can
    /// pass on the half that works.</para>
    /// </summary>
    public class PlanWriteElectionTests
    {
        /// <summary>
        /// A host that records what an Uplink asked for and nothing else, so the
        /// declaration and the registration can be compared to each other.
        /// </summary>
        private sealed class RecordingHost : IUplinkHost
        {
            public List<string> HandlersRegistered { get; } = new List<string>();

            public List<string> PublishersTaken { get; } = new List<string>();

            public List<string> SampledSourceTopics { get; } = new List<string>();

            public Availability? Availability { get; private set; }

            public void AddCommandHandler<TArgs, TResult>(string command, Func<TArgs, TResult> handler)
            {
                Assert.NotNull(handler);
                HandlersRegistered.Add(command);
            }

            public IChannelPublisher Publisher(string topic)
            {
                PublishersTaken.Add(topic);
                return new NullPublisher();
            }

            public void AddSampledSource(
                Func<KspSnapshot?, object?> captureOnMainThread,
                Action<object?> handleOnCourier,
                params string[] subscriptionTopicPrefixes) =>
                SampledSourceTopics.AddRange(subscriptionTopicPrefixes);

            public void SetAvailability(Availability availability) => Availability = availability;

            /// <summary>
            /// Everything below throws rather than answering.
            ///
            /// <para>A recording host that quietly accepted every call would pass
            /// this file's assertions while the Uplink did something else entirely
            /// on the way past. Throwing means the recorded set is the WHOLE set:
            /// if registration starts doing something new, this fails and says
            /// so.</para>
            /// </summary>
            private static NotSupportedException NotExpected(string what) =>
                new NotSupportedException(
                    "PrincipiaUplink.Register is not expected to call " + what
                    + "; if that changed, the recording above no longer describes what it does");

            public double NowUt() => throw NotExpected("NowUt");

            public void AddSampler(ISnapshotSampler sampler) => throw NotExpected("AddSampler");

            public void AddChannelSource(string topic, Func<KspSnapshot?, object?> map) =>
                throw NotExpected("AddChannelSource");

            public void AddSampledSource(
                Func<KspSnapshot?, object?> captureOnMainThread, Action<object?> handleOnCourier) =>
                throw NotExpected("the untopiced AddSampledSource");

            public bool IsAnyTopicSubscribed(string topicPrefix) =>
                throw NotExpected("IsAnyTopicSubscribed");

            public IDynamicChannelSource RegisterDynamicNamespace(
                string prefix, ChannelDeclaration template) =>
                throw NotExpected("RegisterDynamicNamespace");

            public void AddGateEvaluator(ICommandGateEvaluator evaluator) =>
                throw NotExpected("AddGateEvaluator");

            public void SetSignalDelaySource(Func<KspSnapshot?, CommsDelay?> computeOnMainThread) =>
                throw NotExpected("SetSignalDelaySource");

            public void SetVesselDelay(string vesselId, double oneWaySeconds) =>
                throw NotExpected("SetVesselDelay");

            public void SetAuthorityDelay(string centreId, string vesselId, double oneWaySeconds) =>
                throw NotExpected("SetAuthorityDelay");

            public void SetCentreDelay(string fromCentreId, string toCentreId, double oneWaySeconds) =>
                throw NotExpected("SetCentreDelay");

            public void SetVesselConnectivity(string vesselId, bool connected) =>
                throw NotExpected("SetVesselConnectivity");

            public void SetConnectivitySource(Func<KspSnapshot?, bool?> computeOnMainThread) =>
                throw NotExpected("SetConnectivitySource");

            public Kernel Kernel => throw NotExpected("Kernel");

            public void ForceKeyframe(string topic) => throw NotExpected("ForceKeyframe");

            public void ResetChannelBirth(IEnumerable<string> topics) =>
                throw NotExpected("ResetChannelBirth");

            private sealed class NullPublisher : IChannelPublisher
            {
                public void Publish(object? payload)
                {
                }

                public void Publish(object? payload, double atUt)
                {
                }
            }
        }

        /// <summary>The nine commands this slice ships, taken from the producer's own
        /// constants so a rename cannot make this list stale without failing.</summary>
        private static readonly string[] Expected =
        {
            PlanCommands.ArmCommand,
            PlanCommands.ReplaceBurnCommand,
            PlanCommands.InsertBurnCommand,
            PlanCommands.RemoveBurnCommand,
            PlanCommands.HorizonCommand,
            PlanCommands.IntegratorCommand,
            PlanCommands.CreateCommand,
            PlanCommands.DeleteCommand,
            PlanCommands.DuplicateCommand,
        };

        private static PrincipiaUplink Available() =>
            new PrincipiaUplink(
                PrincipiaGuardResult.Ok(new Version(2026, 8, 12, 215)));

        /// <summary>
        /// Every declared command has a handler and every handler a declaration.
        ///
        /// <para>This is the exact shape that shipped broken. A command declared and
        /// not handled is dispatched into nothing; a handler registered for a command
        /// nobody declared is never reached, because the engine routes on the
        /// manifest. Both look fine from either side on its own.</para>
        /// </summary>
        [Fact]
        public void EveryDeclaredCommandHasAHandlerAndEveryHandlerADeclaration()
        {
            var uplink = Available();
            var host = new RecordingHost();

            uplink.Register(host);

            var declared = uplink.Manifest.Commands.Select(c => c.Command).OrderBy(n => n).ToArray();
            var registered = host.HandlersRegistered.OrderBy(n => n).ToArray();

            Assert.Equal(Expected.OrderBy(n => n).ToArray(), declared);
            Assert.Equal(declared, registered);
        }

        /// <summary>
        /// The plan channel is declared, has a publisher taken, and has a sampled
        /// source attached to that same topic. A channel declared and never sourced
        /// publishes nothing forever, and says so nowhere.
        /// </summary>
        [Fact]
        public void ThePlanChannelIsDeclaredPublishedAndSourced()
        {
            var uplink = Available();
            var host = new RecordingHost();

            uplink.Register(host);

            Assert.Contains(PrincipiaUplink.PlanTopic, uplink.Manifest.Channels.Select(c => c.Topic));
            Assert.Contains(PrincipiaUplink.PlanTopic, host.PublishersTaken);
            Assert.Contains(PrincipiaUplink.PlanTopic, host.SampledSourceTopics);
        }

        /// <summary>
        /// Every plan write rides the signal delay, including the arm.
        ///
        /// <para>Not a formality. A plan is what the craft will fly, every write is
        /// persisted into the save and moves a stock maneuver node on the vessel, and
        /// arming performs a real write of Principia's own burn as its probe. A
        /// command declared instant would let an operator change a craft's plan with
        /// no light-time at all.</para>
        /// </summary>
        [Fact]
        public void EveryPlanWriteRidesTheDelayIncludingTheArm()
        {
            var uplink = Available();

            Assert.All(uplink.Manifest.Commands, c => Assert.True(c.Delayed, c.Command));
        }

        /// <summary>
        /// Nothing is registered at all when Principia is absent, so the write
        /// surface cannot be reached on an install that does not have it.
        /// </summary>
        [Fact]
        public void AnAbsentProducerRegistersNoWriteSurface()
        {
            var uplink = new PrincipiaUplink(PrincipiaGuardResult.Fail("Principia not detected"));
            var host = new RecordingHost();

            uplink.Register(host);

            Assert.Empty(host.HandlersRegistered);
            Assert.NotNull(host.Availability);
        }

        /// <summary>
        /// The write register and the port agree in both directions, and every write
        /// Principia exports is accounted for in one list or the other.
        ///
        /// <para>Thirteen is not a number this test invents: it is the size of the
        /// closed set the safety analysis derived from Principia's own access
        /// control, intersected with the shipped export table. Asserting the total
        /// is what makes the register certify its own completeness rather than
        /// describe what somebody happened to want.</para>
        /// </summary>
        [Fact]
        public void AllThirteenWritesAreAccountedFor()
        {
            var accounted = PrincipiaWriteCalls.Allowed
                .Concat(PrincipiaWriteCalls.Refused.Keys)
                .ToArray();

            Assert.Equal(13, accounted.Length);
            Assert.Equal(accounted.Length, accounted.Distinct().Count());

            foreach (var write in new[]
                     {
                         "FlightPlanCreate", "FlightPlanDelete", "FlightPlanDuplicate",
                         "FlightPlanSelect", "FlightPlanInsert", "FlightPlanRemove",
                         "FlightPlanReplace", "FlightPlanRebase",
                         "FlightPlanSetDesiredFinalTime", "FlightPlanSetAdaptiveStepParameters",
                         "FlightPlanUpdateFromOptimization", "FlightPlanOptimizationDriverMake",
                         "FlightPlanOptimizationDriverStart",
                     })
            {
                Assert.Contains(write, accounted);
            }
        }

        /// <summary>
        /// A refused write cannot be bound, and the refusal names what actually
        /// happens rather than saying "not on the list".
        /// </summary>
        [Fact]
        public void EveryRefusedWriteIsRefusedWithItsOwnReason()
        {
            foreach (var pair in PrincipiaWriteCalls.Refused)
            {
                var thrown = Assert.Throws<PrincipiaRefusedCallException>(
                    () => PrincipiaWriteCalls.RequireAllowed(pair.Key));
                Assert.Contains(pair.Value, thrown.Message);
                Assert.False(PrincipiaWriteCalls.IsAllowed(pair.Key));
            }
        }

        /// <summary>
        /// The READ register still refuses every one of the writes, so the write
        /// surface cannot be acquired by adding a name to the read allowlist.
        /// </summary>
        [Fact]
        public void TheReadRegisterStillRefusesEveryWrite()
        {
            foreach (var write in PrincipiaWriteCalls.Allowed)
            {
                Assert.False(
                    PrincipiaCalls.IsAllowed(write),
                    write + " is bindable through the READ register, which is the door that must "
                    + "stay shut");
            }
        }

        /// <summary>
        /// The reflected bind really resolves the producer's own method names, and a
        /// build missing one fails the WRITE half only.
        ///
        /// <para>The stand-in below declares the same static names Principia's
        /// forwarder does, so the lookup under test is the real one. Without this,
        /// the write register and the port could agree perfectly while nothing could
        /// ever be bound, which is the sibling slice's defect exactly.</para>
        /// </summary>
        [Fact]
        public void TheBindResolvesEveryWriteOnAForwarderShapedLikeTheProducers()
        {
            foreach (var name in PrincipiaWriteCalls.Allowed.Concat(PrincipiaWriteCalls.AllowedReads))
            {
                Assert.NotNull(
                    ReflectedPrincipiaPlugin.BindWriteMethod(typeof(FakeWriteForwarder), name));
            }
        }

        [Fact]
        public void AForwarderMissingAWriteBindsNothingForThatName()
        {
            Assert.Null(
                ReflectedPrincipiaPlugin.BindWriteMethod(
                    typeof(ForwarderWithoutReplace), "FlightPlanReplace"));
        }

        /// <summary>
        /// A refused name cannot be bound even through the write door, and the check
        /// fires before the type is looked at, so it holds with no producer
        /// installed.
        /// </summary>
        [Fact]
        public void ARefusedWriteCannotBeBoundThroughTheWriteDoorEither()
        {
            Assert.Throws<PrincipiaRefusedCallException>(
                () => ReflectedPrincipiaPlugin.BindWriteMethod(
                    typeof(FakeWriteForwarder), "FlightPlanSelect"));
        }

        /// <summary>
        /// Principia's forwarder, by name and shape: static methods taking the plugin
        /// handle first, exactly as its extension methods compile to.
        /// </summary>
        private static class FakeWriteForwarder
        {
            internal static object? FlightPlanInsert(IntPtr plugin, string guid, object burn, int index) => null;

            internal static object? FlightPlanReplace(IntPtr plugin, string guid, object burn, int index) => null;

            internal static object? FlightPlanRemove(IntPtr plugin, string guid, int index) => null;

            internal static object? FlightPlanSetDesiredFinalTime(IntPtr plugin, string guid, double t) => null;

            internal static object? FlightPlanSetAdaptiveStepParameters(
                IntPtr plugin, string guid, object parameters) => null;

            internal static void FlightPlanCreate(IntPtr plugin, string guid, double t, double mass)
            {
            }

            internal static void FlightPlanDelete(IntPtr plugin, string guid)
            {
            }

            internal static void FlightPlanDuplicate(IntPtr plugin, string guid)
            {
            }

            internal static int FlightPlanOptimizationDriverInProgress(IntPtr plugin, string guid) => -1;

            /// <summary>Present so the refusal test has something to NOT bind: the
            /// name resolves on the type and the register refuses it anyway.</summary>
            internal static void FlightPlanSelect(IntPtr plugin, string guid, int index)
            {
            }
        }

        private static class ForwarderWithoutReplace
        {
            internal static object? FlightPlanInsert(IntPtr plugin, string guid, object burn, int index) => null;
        }
    }
}
