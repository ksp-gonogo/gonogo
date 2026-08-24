using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Xunit;

namespace GonogoPrincipiaUplink.Tests
{
    /// <summary>
    /// A host that records what an Uplink asked for and nothing else, so a
    /// declaration and a registration can be compared to each other.
    ///
    /// <para>Its <see cref="Kernel"/> is a REAL one, not a recorder. What an Uplink
    /// registers into a capability is only half a wiring claim: the other half is
    /// what the election then resolves, and a recorded list of registrations cannot
    /// answer that. Resolving the real kernel can.</para>
    /// </summary>
    internal sealed class RecordingUplinkHost : IUplinkHost
    {
        public List<string> HandlersRegistered { get; } = new List<string>();

        public List<string> PublishersTaken { get; } = new List<string>();

        public List<string> SampledSourceTopics { get; } = new List<string>();

        /// <summary>
        /// The capture/handle pairs registered with NO topic prefixes, which the
        /// engine therefore runs on every tick regardless of what is subscribed.
        ///
        /// <para>Recorded as the callable pair rather than counted, because what a
        /// test of one of these has to establish is that driving the capture reaches
        /// the handler: a source registered but never joined up is the failure this
        /// is here to catch.</para>
        /// </summary>
        public List<(Func<KspSnapshot?, object?> Capture, Action<object?> Handle)>
            UngatedSampledSources { get; } =
            new List<(Func<KspSnapshot?, object?>, Action<object?>)>();

        public Availability? Availability { get; private set; }

        /// <summary>
        /// A REAL kernel, with the capabilities core declares already declared on it.
        ///
        /// <para>Declared here rather than per test because that is the order the
        /// engine guarantees: every capability is declared in a pass that completes
        /// before any Uplink's <c>Register</c> runs, so a registration can never
        /// race ahead of its declaration. A kernel with nothing declared is not a
        /// stricter test, it is a different situation than the one an Uplink is ever
        /// in, and registering into an undeclared capability throws.</para>
        ///
        /// <para>The propagation vanilla is a stand-in: the real two-body solver
        /// lives in an assembly an Uplink may not reference, and that constraint is
        /// the point rather than a limitation. What matters here is that the vanilla
        /// exists, is reachable through <see cref="ProviderContext.Vanilla{T}"/>,
        /// and does NOT claim integrated trajectories.</para>
        /// </summary>
        public Kernel Kernel { get; } = Declared();

        private static Kernel Declared()
        {
            var kernel = new Kernel();
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = PropagationCapability.Id,
                Exclusive = true,
                SpineCritical = false,
                Vanilla = _ => new StandInConics(),
            });
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = GravityModelCapability.Id,
                Exclusive = true,
                SpineCritical = false,
                // No vanilla, exactly as core declares it: stock has no n-body
                // force model, and unsatisfied is the honest state.
                Vanilla = null,
            });
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = ManeuverPlanCapability.Id,
                Exclusive = true,
                SpineCritical = false,
                // Core declares this with stock's patched-conic backend as the
                // vanilla. Null here because nothing in these tests reads it, and
                // a stand-in would be a second thing to keep in step with core for
                // no gain.
                Vanilla = null,
            });
            kernel.RegisterCapability(new CapabilityDescriptor
            {
                Id = ControlFrameCapability.Id,
                Exclusive = true,
                SpineCritical = false,
                // Core declares this one WITH a vanilla, because stock's map view
                // really is body-centred inertial. Null here only because nothing
                // in these tests reads the stock answer, and a stand-in would be a
                // second thing to keep in step with core for no gain.
                Vanilla = null,
            });
            return kernel;
        }

        /// <summary>
        /// The displaced two-body solver, present so the election has something to
        /// fall back to and something for a winner to forward to. Deliberately not an
        /// <see cref="IIntegratedTrajectorySource"/>.
        /// </summary>
        private sealed class StandInConics : IPropagationProvider
        {
            public string ProviderId => "stand-in-conics";

            public StateVector Solve(PropagationTarget target, PropagationFrame frame, double ut) =>
                new StateVector(new Vector3d(0, 0, 0), new Vector3d(0, 0, 0));

            public void SolveMany(
                PropagationTarget target,
                PropagationFrame frame,
                IReadOnlyList<double> uts,
                StateVector[] into)
            {
            }

            public double? CharacteristicCycleSeconds(PropagationTarget target) => null;

            public RadiusExtremes? RadiusExtremesOf(PropagationTarget target) => null;

            public bool CanPropagate(
                PropagationTarget target, PropagationFrame frame, double fromUt, double toUt) => false;

            public ClosestApproach? SolveClosestApproach(
                PropagationTarget subject,
                PropagationTarget other,
                PropagationFrame frame,
                double fromUt,
                double toUt) => null;
        }

        public void AddCommandHandler<TArgs, TResult>(string command, Func<TArgs, TResult> handler)
        {
            Assert.NotNull(handler);
            HandlersRegistered.Add(command);
        }
        public void AddVantageCommandHandler<TArgs, TResult>(
            string command, Func<TArgs, string, TResult> handler)
        {
            // Recorded into the same list as the plain path. What the parity test
            // asserts is that every declared command HAS a handler, and by which
            // route it was registered is not part of that claim.
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

        public void AddSampledSource(
            Func<KspSnapshot?, object?> captureOnMainThread, Action<object?> handleOnCourier) =>
            UngatedSampledSources.Add((captureOnMainThread, handleOnCourier));

        public void SetAvailability(Availability availability) => Availability = availability;

        /// <summary>
        /// Everything below throws rather than answering.
        ///
        /// <para>A recording host that quietly accepted every call would pass its
        /// callers' assertions while the Uplink did something else entirely on the
        /// way past. Throwing means the recorded set is the WHOLE set: if
        /// registration starts doing something new, the callers fail and say
        /// so.</para>
        /// </summary>
        private static NotSupportedException NotExpected(string what) =>
            new NotSupportedException(
                "PrincipiaUplink.Register is not expected to call " + what
                + "; if that changed, the recording above no longer describes what it does");

        public double NowUt() => throw NotExpected("NowUt");

        /// <summary>Recorded rather than refused: the frame the control-frame
        /// capability answers from is kept fresh by one of these, and a test that
        /// threw here could not tell a registered sampler from an absent one.</summary>
        public List<ISnapshotSampler> Samplers { get; } = new List<ISnapshotSampler>();

        public void AddSampler(ISnapshotSampler sampler) => Samplers.Add(sampler);

        public void AddChannelSource(string topic, Func<KspSnapshot?, object?> map) =>
            throw NotExpected("AddChannelSource");

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
}
