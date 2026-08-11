using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;

namespace Gonogo.KerbalismUplink
{
    /// <summary>
    /// The KerbalismUplink (Domain "kerbalism"): emits space weather, life
    /// support, per-kerbal survival state and the Kerbalism feature flags for the
    /// active vessel, all by reflection over Kerbalism (KerbalismReflection, zero
    /// compile-time link, presence-safe). It ALSO registers Kerbalism as the
    /// low-specificity (Priority 1) provider of the Domain-neutral "reliability"
    /// Kernel capability (owned by ReliabilityCoreUplink); TestFlight registers
    /// Priority 10 and supersedes it under RO. Presence-gated (kerbalism.available),
    /// mandatory Health(), delay-gated per Topic (presence/features TrueNow, the
    /// vessel telemetry Delayed).
    /// </summary>
    [SitrepUplink("kerbalism")]
    public sealed class KerbalismUplink : ISitrepUplink
    {
        private const string AvailableTopic = "kerbalism.available";
        private const string FeaturesTopic = "kerbalism.features";
        private const string SpaceWeatherTopic = "kerbalism.spaceweather";
        private const string LifeSupportTopic = "kerbalism.lifesupport";
        private const string CrewTopic = "kerbalism.crew";
        private const string ProfileTopic = "kerbalism.profile";

        private readonly KerbalismReflection _k = new();

        /// <summary>
        /// The elected "science" backend, held rather than constructed per factory
        /// call because it is fed by this Uplink's own main-thread capture: see
        /// <see cref="RegisterScience"/>.
        /// </summary>
        private readonly KerbalismScienceBackend _science = new();

        private IChannelPublisher? _spaceWeather;
        private IChannelPublisher? _lifeSupport;
        private IChannelPublisher? _crew;

        /// <summary>Built once on first use; see <see cref="Profile"/>.</summary>
        private ProfileRaw? _profile;

        public UplinkManifest Manifest { get; }

        public KerbalismUplink()
        {
            Manifest = new UplinkManifest
            {
                Id = "kerbalism",
                Version = "1.0.0",
                Channels = new List<ChannelDeclaration>
                {
                    TrueNow(AvailableTopic),
                    TrueNow(FeaturesTopic),
                    Static(ProfileTopic),
                    Delayed(SpaceWeatherTopic),
                    Delayed(LifeSupportTopic),
                    Delayed(CrewTopic),
                },
            };
        }

        private static ChannelDeclaration TrueNow(string topic) => new()
        {
            Topic = topic,
            Delivery = Delivery.LossyLatest,
            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
            Delay = DelayRole.TrueNow,
        };

        /// <summary>
        /// A ground-side fact that never changes within a session (swapping the
        /// Kerbalism profile is a KSP restart). Keyframed occasionally so a late
        /// or rejoining subscriber still gets it, and sampled at most once a
        /// minute so a static payload costs nothing to carry.
        /// </summary>
        private static ChannelDeclaration Static(string topic) => new()
        {
            Topic = topic,
            Delivery = Delivery.LossyLatest,
            Emission = new EmissionPolicy(
                keyframeIntervalUt: 300,
                quantum: EmissionQuantum.Absolute(0),
                minSampleIntervalUt: 60),
            Delay = DelayRole.TrueNow,
        };

        private static ChannelDeclaration Delayed(string topic) => new()
        {
            Topic = topic,
            Delivery = Delivery.LossyLatest,
            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
            Delay = DelayRole.Delayed,
        };

        public void Register(IUplinkHost host)
        {
            // Ground-side facts (presence + feature flags): pull-style, Courier-thread,
            // no live-KSP read beyond the cheap reflection cache.
            host.AddChannelSource(AvailableTopic, _ => _k.IsAvailable);
            host.AddChannelSource(FeaturesTopic, _ =>
                _k.IsAvailable ? KerbalismCapture.BuildFeatures(_k.Features()) : null);
            host.AddChannelSource(ProfileTopic, _ =>
                _k.IsAvailable ? KerbalismCapture.BuildProfile(Profile()) : null);

            _spaceWeather = host.Publisher(SpaceWeatherTopic);
            _lifeSupport = host.Publisher(LifeSupportTopic);
            _crew = host.Publisher(CrewTopic);

            // Vessel telemetry: capture live Kerbalism on the main thread, publish off it.
            host.AddSampledSource(
                CaptureOnMain,
                HandleOnCourier,
                SpaceWeatherTopic,
                LifeSupportTopic,
                CrewTopic);

            // Register Kerbalism as the Priority-1 "reliability" provider. The capability
            // is owned + declared by ReliabilityCoreUplink (bundled core) in the pre-Register
            // pass, so it is present here regardless of assembly-scan order (the same two-pass
            // guarantee the comms capability provider relies on). The provider self-reports
            // unmodeled when Features.Reliability is off; TestFlight (Priority 10) supersedes
            // it under RO.
            if (_k.IsAvailable)
            {
                try
                {
                    host.Kernel.RegisterProvider(new ProviderRegistration
                    {
                        Capability = "reliability",
                        Id = "kerbalism",
                        Priority = 1.0,
                        Factory = _ => new KerbalismReliabilityBackend(_k),
                    });
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("[KerbalismUplink] could not register reliability provider: " + ex.Message);
                }

                RegisterScience(host);
            }
        }

        /// <summary>
        /// Register Kerbalism as the "science" provider, above the stock vanilla
        /// backend so it WINS when Kerbalism is installed. Same
        /// registering-is-the-gate rule as reliability above, and the same two-pass
        /// guarantee: the capability is owned and declared by ScienceCoreUplink
        /// (bundled core) in the pre-Register pass, so it exists here regardless of
        /// assembly-scan order.
        ///
        /// <para>Unlike reliability, this provider is STATEFUL: its reads run on the
        /// Courier thread and Kerbalism's science lives in PartModules that must be
        /// read on the main thread, so it is fed by its own capture-on-main source
        /// below and the SAME instance has to be both fed and elected. Hence one
        /// instance closed over by the factory, rather than a factory that
        /// constructs.</para>
        ///
        /// <para>The capture is gated on <c>"science."</c> subscriptions, so a
        /// vessel-wide drive/module walk costs nothing while no client is looking at
        /// science. The gate is a pure early-out: a late subscriber still gets the
        /// current value the ordinary way.</para>
        /// </summary>
        private void RegisterScience(IUplinkHost host)
        {
            try
            {
                host.Kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = "science",
                    Id = KerbalismScienceMap.ProviderId,
                    // Above the stock vanilla backend: on a Kerbalism install the
                    // stock walk finds nothing (results live on Kerbalism's drives,
                    // not in ModuleScienceExperiment), so losing this election would
                    // mean an empty science dashboard, not a degraded one.
                    Priority = 1.0,
                    Factory = _ => _science,
                });
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[KerbalismUplink] could not register science provider: " + ex.Message);
                return;
            }

            host.AddSampledSource(CaptureScienceOnMain, HandleScienceOnCourier, "science.");
        }

        /// <summary>MAIN-THREAD capture: read live Kerbalism science into a plain bundle (no KSP handles cross threads).</summary>
        private object? CaptureScienceOnMain(KspSnapshot? snapshot)
        {
            var v = FlightGlobals.ActiveVessel;
            if (v == null || !_k.IsAvailable) return null;
            return _k.Science(v);
        }

        /// <summary>COURIER-THREAD handle: hand the capture to the elected backend, which maps it per channel. No KSP access.</summary>
        private void HandleScienceOnCourier(object? captured)
        {
            if (captured is ScienceRaw raw) _science.Stash(raw);
        }

        /// <summary>MAIN-THREAD capture: read live Kerbalism into a plain bundle (no KSP handles cross threads).</summary>
        private object? CaptureOnMain(KspSnapshot? snapshot)
        {
            var v = FlightGlobals.ActiveVessel;
            if (v == null || !_k.IsAvailable) return null;

            double R(string res) => _k.ApiResource("ResourceAmount", v, res) ?? 0;
            double Cap(string res) => _k.ApiResource("ResourceCapacity", v, res) ?? 0;
            double Rate(string res) => _k.ApiResource("ResourceAverageRate", v, res) ?? 0;

            var s = new KerbalismSnapshot
            {
                Radiation = _k.Api("Radiation", v) ?? 0,
                HabitatRadiation = _k.Api("HabitatRadiation", v) ?? 0,
                Magnetosphere = _k.ApiBool("Magnetosphere", v) ?? false,
                InnerBelt = _k.ApiBool("InnerBelt", v) ?? false,
                OuterBelt = _k.ApiBool("OuterBelt", v) ?? false,
                StormIncoming = _k.ApiBool("StormIncoming", v) ?? false,
                StormInProgress = _k.ApiBool("StormInProgress", v) ?? false,
                Blackout = _k.ApiBool("Blackout", v) ?? false,
                InSunlight = _k.ApiBool("InSunlight", v) ?? false,
                ShieldingAmount = R("Shielding"),
                ShieldingCapacity = Cap("Shielding"),
                // One rate per resource the LOADED PROFILE mentions, not per name
                // we picked. `ResourceAverageRate` needs a name to ask about, so
                // something must enumerate; the only honest enumerator is the
                // profile itself, and it is the same list kerbalism.profile
                // publishes so the two cannot drift.
                Rates = RatesFor(Rate),
                Pressure = _k.Api("Pressure", v) ?? 0,
                Poisoning = _k.Api("Poisoning", v) ?? 0,
                Shielding = _k.Api("Shielding", v) ?? 0,
                LivingSpace = _k.Api("LivingSpace", v) ?? 0,
                Comfort = _k.Api("Comfort", v) ?? 0,
                Volume = _k.Api("Volume", v) ?? 0,
                Surface = _k.Api("Surface", v) ?? 0,
            };

            var profile = Profile();
            var processes = new List<ProcessRaw>(_k.Processes(v));
            var modifierCtx = _k.BeginModifierContext(v);
            ApplyProcessEnvModifiers(processes, profile, v, modifierCtx);

            return new KerbalismCaptured
            {
                Ut = snapshot?.Ut ?? 0.0,
                Snapshot = s,
                Processes = processes,
                Crew = new List<KerbalRulesRaw>(_k.CrewRules(v)),
                RuleConstants = _k.RuleConstants(),
                Solar = _k.Solar(v),
                StormEjectionSpeed = _k.StormEjectionSpeed(),
                RuleEnvModifiers = RuleEnvModifiers(profile, v, modifierCtx),
            };
        }

        /// <summary>
        /// Joins each captured process instance onto its profile Process definition
        /// by the pseudo-resource token (entry.Resource), then evaluates Kerbalism's
        /// live modifier product over that definition's modifiers MINUS the join
        /// token itself (already accounted for via Capacity; see
        /// KerbalismProcessEntry.EnvModifier's doc comment for why it must be
        /// excluded). Mutates each ProcessRaw in place.
        /// </summary>
        private void ApplyProcessEnvModifiers(
            List<ProcessRaw> processes, ProfileRaw profile, Vessel v, KerbalismReflection.ModifierContext? ctx)
        {
            if (processes.Count == 0) return;
            var byModifierToken = new Dictionary<string, ProcessDefRaw>(StringComparer.Ordinal);
            foreach (var def in profile.Processes)
                foreach (var token in def.Modifiers)
                    byModifierToken[token] = def;

            foreach (var p in processes)
            {
                if (string.IsNullOrEmpty(p.Resource) || !byModifierToken.TryGetValue(p.Resource, out var def)) continue;
                var filtered = def.Modifiers.Where(m => m != p.Resource).ToList();
                p.EnvModifier = _k.EvaluateModifiers(ctx, v, filtered);
            }
        }

        /// <summary>
        /// Live modifier product per rule name, over each rule's FULL modifier
        /// list (rules have no pseudo-resource join token to exclude, unlike
        /// processes). See KerbalismLifeSupport.RuleEnvModifiers' doc comment for
        /// why this rides the live lifesupport capture rather than the static
        /// profile channel.
        /// </summary>
        private Dictionary<string, double> RuleEnvModifiers(
            ProfileRaw profile, Vessel v, KerbalismReflection.ModifierContext? ctx)
        {
            var result = new Dictionary<string, double>(StringComparer.Ordinal);
            foreach (var rule in profile.Rules)
            {
                var k = _k.EvaluateModifiers(ctx, v, rule.Modifiers);
                if (k.HasValue) result[rule.Name] = k.Value;
            }
            return result;
        }

        /// <summary>
        /// Ask Kerbalism for a net rate per resource the loaded profile mentions.
        /// Resources it will not answer for are simply absent from the map, which
        /// is the channel's documented "no rate reported" case, distinct from a
        /// present zero.
        /// </summary>
        private Dictionary<string, double> RatesFor(Func<string, double> rate)
        {
            var names = KerbalismCapture.ResourceNames(Profile());
            var map = new Dictionary<string, double>(names.Count, StringComparer.Ordinal);
            foreach (var name in names) map[name] = rate(name);
            return map;
        }

        /// <summary>
        /// The loaded profile, read once. `Profile.rules`/`.processes`/`.supplies`
        /// are static and do not change after load, so rebuilding this per sample
        /// would be the one way to make a static Topic expensive.
        /// </summary>
        private ProfileRaw Profile() => _profile ??= _k.Profile();

        /// <summary>COURIER-THREAD handle: publish the captured value trees. No KSP access.</summary>
        private void HandleOnCourier(object? captured)
        {
            if (captured is not KerbalismCaptured c) return;
            _spaceWeather?.Publish(
                KerbalismCapture.BuildSpaceWeather(c.Snapshot, c.Solar.Stars, c.Solar.Storms, c.StormEjectionSpeed), c.Ut);
            _lifeSupport?.Publish(
                KerbalismCapture.BuildLifeSupport(c.Snapshot, c.Processes, c.Snapshot.Rates, c.RuleEnvModifiers), c.Ut);
            _crew?.Publish(KerbalismCapture.BuildCrew(c.Crew, c.RuleConstants), c.Ut);
        }

        public UplinkHealth Health() =>
            _k.IsAvailable
                ? UplinkHealth.Healthy
                : new UplinkHealth(UplinkHealthState.Unavailable, "Kerbalism assembly not loaded");

        /// <summary>Plain cross-thread bundle: no live KSP references.</summary>
        private sealed class KerbalismCaptured
        {
            public double Ut;
            public KerbalismSnapshot Snapshot;
            public List<ProcessRaw> Processes = new();
            public List<KerbalRulesRaw> Crew = new();
            public IReadOnlyDictionary<string, RuleConstants> RuleConstants = new Dictionary<string, RuleConstants>();
            public SolarRaw Solar = new();
            public double? StormEjectionSpeed;
            public IReadOnlyDictionary<string, double> RuleEnvModifiers = new Dictionary<string, double>();
        }
    }
}
