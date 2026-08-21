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

        /// <summary>Test seam for the settings half, same reasoning.</summary>
        internal PrincipiaUplink(PrincipiaGuardResult guard, ISettingsSource settings)
            : this(guard)
        {
            _settings = settings;
        }

        public const string FlightPlanTopic = "principia.flightPlan";
        public const string SettingsTopic = "principia.settings";

        private IFlightPlanObserver? _observer;
        private ISettingsSource? _settings;
        private readonly SettingsReflection _settingsReader = new SettingsReflection();
        private readonly NativeSettingsReader _nativeSettingsReader = new NativeSettingsReader();
        private IChannelPublisher? _flightPlan;
        private IChannelPublisher? _settingsPublisher;
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
                // TrueNow, unlike the flight plan beside it, and the difference is
                // real rather than an oversight. These are the operator's own
                // settings and the producer's local configuration: ground-side
                // facts about how the numbers are being computed, not observations
                // travelling from a craft. Delaying them would mean an operator
                // adjusting a tolerance could not see the new basis for their
                // readouts until light-time had passed, which is nonsense for a
                // setting they just changed on the same machine.
                new ChannelDeclaration
                {
                    Topic = SettingsTopic,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.TrueNow,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
            },
        };

        /// <summary>
        /// Attaches the flight-plan observer and sources its channel.
        ///
        /// <para>The propagation PROVIDER is not registered here yet, but the
        /// boundary that used to make it impossible is gone:
        /// <c>IPropagationProvider</c> lives in <c>Sitrep.Contract</c> now,
        /// alongside <c>IReliabilityBackend</c> and <c>IActionGroupsBackend</c>, so
        /// an Uplink can build against it. Registering one from here is a piece of
        /// work rather than a boundary violation.</para>
        ///
        /// <para>Two things such a provider should know. Closest approach is part
        /// of that interface rather than a capability beside it, so winning
        /// propagation means answering the encounter too, which is what stops an
        /// integrated trajectory and a two-body encounter reaching the wire for the
        /// same vessel at the same instant. And the conic answers the
        /// transfer-window search needs are reachable through
        /// <c>ProviderContext.Vanilla</c>: the displaced two-body provider is a
        /// tool, not a rival, and no provider should be carrying a second copy of
        /// Lambert to get at it.</para>
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
            _settings?.TryAttach();
            _flightPlan = host.Publisher(FlightPlanTopic);
            host.AddSampledSource(CaptureOnMain, HandleOnCourier, FlightPlanTopic);
            _settingsPublisher = host.Publisher(SettingsTopic);
            host.AddSampledSource(CaptureSettingsOnMain, HandleSettingsOnCourier, SettingsTopic);
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
        /// MAIN-THREAD capture: reads every setting this tick, or says why it did
        /// not.
        ///
        /// <para>Published every tick rather than on change, unlike the flight plan.
        /// The difference is what the payload CLAIMS: a flight-plan sample asserts a
        /// past observation, so re-stamping it would move that observation forward in
        /// time, while these settings are true now and saying so repeatedly is
        /// honest.</para>
        ///
        /// <para><b>The journal check comes first, and it decides whether we read at
        /// all.</b> With a recorder running, the producer writes every call made
        /// through its plugin interface into the player's replay journal, ours
        /// included, and that journal is the artefact one of its bug reports is made
        /// of. So the managed half is read, the actual journaling state is taken from
        /// it, and if a recorder is active the whole reading is thrown away and
        /// replaced by a stated outage before the plugin is touched at all. It gates
        /// on the ACTUAL state rather than the requested one deliberately: the
        /// request only takes effect on load, so gating on it would stop us a session
        /// early and then fail to stop us at all in the case that matters.</para>
        /// </summary>
        internal object? CaptureSettingsOnMain(KspSnapshot? snapshot)
        {
            if (_settings == null)
            {
                return null;
            }
            var ut = snapshot?.Ut ?? 0.0;
            var version = _settings.Session?.Version;
            var observation = new SettingsObservation { SampledAtUt = ut, PluginVersion = version };
            _settingsReader.Read(_settings, observation);

            if (observation.Journaling == true)
            {
                return SettingsObservation.Suspended(ut, version, JournalSuspensionReason);
            }

            observation.TargetCelestialBody = _settings.TargetCelestialBody;
            _nativeSettingsReader.Read(_settings, observation);
            return observation;
        }

        /// <summary>What an operator is told while we have stopped reading, and the
        /// one action that resumes it.</summary>
        internal const string JournalSuspensionReason =
            "Principia is recording a journal, so Gonogo has stopped reading from it. A journal "
            + "with our polling interleaved is no longer a replay of your session, and it is the "
            + "file a Principia bug report is made of. Turn off Record journal in Principia's "
            + "logging settings to resume.";

        internal void HandleSettingsOnCourier(object? captured)
        {
            if (captured is not SettingsObservation observation)
            {
                return;
            }
            _settingsPublisher?.Publish(
                SettingsBuilder.Build(observation), observation.SampledAtUt);
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
