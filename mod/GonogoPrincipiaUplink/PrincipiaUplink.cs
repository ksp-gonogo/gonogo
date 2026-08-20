// The [SitrepUplink("principia")] uplink: detection, plus the flight plan.
//
// Presence is still conveyed by system.uplinks health (Health() below) rather than
// by a principia.available topic, because nothing needs one: a client gates on the
// flight-plan channel carrying a sample, which is a stronger fact than the mod being
// loaded.
//
// It is ALSO the answer to a narrower question. `VesselPhysicsMode.IsPrincipiaActive`
// was deleted in the Major 2 -> 3 bump because "core detecting a specific
// third-party mod was a mod-seam violation; that awareness belongs to a future
// Principia Uplink instead". This is that Uplink, and detection is the whole of
// what it owns: nothing in core learns the mod's name, and the substantive fact
// reaches clients as a property of the ANSWER (an integrated trajectory, bounded
// by a horizon) rather than as the vendor's identity.
using Sitrep.Contract;

using System.Collections.Generic;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Partial, and the other half is the only part that needs the game.
    ///
    /// <para><c>AttachObserver</c> is a partial method implemented in
    /// <c>PrincipiaUplink.Observer.cs</c>, which is the one file here that names a
    /// Harmony or KSP type. A build that omits that file (this uplink's headless
    /// test project) still compiles: an unimplemented partial method call is
    /// removed, the observer stays null, and every publish decision below remains
    /// exercisable with a fake. That is why the publish rule is testable at all,
    /// and it is the property to preserve when adding to this class.</para>
    /// </summary>
    [SitrepUplink("principia")]
    public sealed partial class PrincipiaUplink : ISitrepUplink
    {
        private readonly PrincipiaGuardResult _guard;

        public PrincipiaUplink()
            : this(PrincipiaVersionGuard.ProbeLoaded())
        {
        }

        /// <summary>Test seam: probe result injected, so the absent and present cases are both reachable without Principia.</summary>
        internal PrincipiaUplink(PrincipiaGuardResult guard)
        {
            _guard = guard;
        }

        /// <summary>Test seam: the observer injected too, so the publish rule is
        /// provable against a scripted sequence of observations.</summary>
        internal PrincipiaUplink(PrincipiaGuardResult guard, IFlightPlanObserver observer)
            : this(guard)
        {
            _observer = observer;
        }

        public const string FlightPlanTopic = "principia.flightPlan";

        private IFlightPlanObserver? _observer;
        private IChannelPublisher? _flightPlan;
        private double _publishedAtUt = double.NegativeInfinity;

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "principia",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = FlightPlanTopic,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.Delayed,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
            },
        };

        /// <summary>
        /// Attaches the flight-plan observer and sources its channel.
        ///
        /// <para>The propagation PROVIDER is still not registered here, and the
        /// reason is a boundary rather than a choice: <c>IPropagationProvider</c>
        /// is in <c>Sitrep.Propagation</c>, a private unpublished assembly an
        /// Uplink may not build against. The isolation gate is right to refuse it,
        /// and the sibling capabilities do not have this problem because
        /// <c>IReliabilityBackend</c> and <c>IActionGroupsBackend</c> both live in
        /// <c>Sitrep.Contract</c>. So the propagation capability is currently
        /// advertised as an extension point no third party can extend, which wants
        /// the interface moved onto the boundary rather than something done quietly
        /// from here.</para>
        /// </summary>
        public void Register(IUplinkHost host)
        {
            if (!_guard.IsAvailable)
            {
                // The guard normally supplies a reason; the fallback names the
                // generic fact rather than an empty string, so an operator reading
                // the roster is never told nothing at all.
                host.SetAvailability(Availability.Unavailable(_guard.Reason ?? "Principia not detected"));
                return;
            }

            AttachObserver();
            _observer?.TryAttach();
            _flightPlan = host.Publisher(FlightPlanTopic);
            host.AddSampledSource(CaptureOnMain, HandleOnCourier, FlightPlanTopic);
        }

        /// <summary>
        /// MAIN-THREAD capture: hands over the latched observation, but only once
        /// per observation.
        ///
        /// <para>Null until the planner has been rendered at least once, and null
        /// again on every tick that adds nothing new. That silence is deliberate and
        /// it is the honest shape: an unobserved plan produces NO sample, so a client
        /// reads "not observed" rather than a fabricated empty plan. Republishing an
        /// unchanged observation every tick would instead assert it afresh at each
        /// new instant, which is the one thing a stamped observation must never
        /// do.</para>
        /// </summary>
        internal object? CaptureOnMain(KspSnapshot? snapshot)
        {
            var latest = _observer?.Latest;
            if (latest == null || latest.ObservedAtUt <= _publishedAtUt)
            {
                return null;
            }
            _publishedAtUt = latest.ObservedAtUt;
            return latest;
        }

        /// <summary>
        /// COURIER-THREAD handle: publishes the plan AT THE INSTANT IT WAS OBSERVED,
        /// not at the current one.
        ///
        /// <para>That is the whole reason this channel is trustworthy. A sample
        /// stamped with its observation UT ages itself through the ordinary timeline
        /// machinery, so a plan last seen six hours ago arrives at a client as a
        /// six-hour-old sample and reads as stale with no special case anywhere.
        /// Stamping it "now" would make every stale plan look fresh, which is
        /// precisely the failure the hook exists to avoid.</para>
        /// </summary>
        internal void HandleOnCourier(object? captured)
        {
            if (captured is not FlightPlanObservation observation)
            {
                return;
            }
            _flightPlan?.Publish(FlightPlanBuilder.Build(observation), observation.ObservedAtUt);
        }

        /// <summary>
        /// Unavailable is the ORDINARY answer, not a fault: Principia is optional
        /// and the stock two-body provider stays correct without it. The reason
        /// string is carried so the roster can say which of "not installed" and
        /// "installed but not a version we know" it is, because those want
        /// different actions from an operator.
        /// </summary>
        /// <summary>Sets <c>_observer</c> to the real hook. Implemented only in the
        /// game-facing partial, so a headless build has no observer and says so by
        /// publishing nothing.</summary>
        partial void AttachObserver();

        public UplinkHealth Health() =>
            _guard.IsAvailable
                ? new UplinkHealth(
                    UplinkHealthState.Healthy,
                    _guard.DetectedVersion == null
                        ? null
                        : "Principia " + _guard.DetectedVersion)
                : new UplinkHealth(UplinkHealthState.Unavailable, _guard.Reason);
    }
}
