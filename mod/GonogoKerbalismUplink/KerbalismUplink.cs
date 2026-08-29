using System;
using System.Collections.Generic;
using System.Linq;
using GonogoKerbalismUplink;
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
    /// vessel telemetry Delayed). Also declares the five File Manager commands
    /// (<see cref="KerbalismFileCommandProvider"/>), presence-gated at the
    /// manifest itself so they never appear at all on a vanilla install.
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

        /// <summary>The live-Drive actuation seam for the File Manager commands (see <see cref="RegisterFileManagerCommands"/>).</summary>
        private readonly IKerbalismFileActuator _fileActuator;

        /// <summary>
        /// The currency-delay science hook: a presence-gated Harmony postfix on Kerbalism's own
        /// RetrieveScience, handing each retrieved increment to the currency-delay core's
        /// source-agnostic DelayedScienceSink. Held so <see cref="Register"/> attaches it once.
        /// </summary>
        private readonly KerbalismScienceHook _scienceHook = new();

        /// <summary>The same reads, for every OTHER craft: see <see cref="KerbalismFleetChannels"/>.</summary>
        private readonly KerbalismFleetChannels _fleet;

        private IChannelPublisher? _spaceWeather;
        private IChannelPublisher? _lifeSupport;
        private IChannelPublisher? _crew;

        /// <summary>Built once on first use; see <see cref="Profile"/>.</summary>
        private ProfileRaw? _profile;

        public UplinkManifest Manifest { get; }

        public KerbalismUplink()
        {
            _fileActuator = new KerbalismFileActuator(_k);
            _fleet = new KerbalismFleetChannels(_k, CaptureVessel);

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
                // Presence-gated at construction, unlike the channels above:
                // _k.IsAvailable is a cheap, session-stable reflection probe
                // (the same one the reliability/isru/science provider
                // registrations below gate on), so when Kerbalism is absent
                // these five commands are not merely unhandled, they never
                // appear in the manifest at all. A client has no reason to
                // ever learn "kerbalism.file.send exists" on a vanilla
                // install, the same registering-is-the-gate rule Register()
                // already applies to the provider registrations.
                Commands = _k.IsAvailable ? FileManagerCommands() : Array.Empty<CommandDeclaration>(),
            };
        }

        /// <summary>
        /// The five File Manager commands: every one actuates Kerbalism state
        /// ON the vessel (flag a file, delete it, flag/dump a sample, move a
        /// sample to another drive), so all ride the same light-time delay
        /// every other vessel actuation does, delayed: true.
        /// </summary>
        private static List<CommandDeclaration> FileManagerCommands() => new()
        {
            Command(KerbalismFileCommandProvider.SendCommand),
            Command(KerbalismFileCommandProvider.DeleteCommand),
            Command(KerbalismFileCommandProvider.AnalyzeCommand),
            Command(KerbalismFileCommandProvider.DumpCommand),
            Command(KerbalismFileCommandProvider.MoveToLabCommand),
        };

        private static CommandDeclaration Command(string command) => new()
        {
            Command = command,
            Delayed = true,
        };

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

            // The rest of the fleet on the same reads, one namespace per craft
            // and gated per craft (see KerbalismFleetChannels). Registered
            // unconditionally alongside the active-vessel channels: its capture
            // does nothing at all until a client subscribes to a specific craft.
            _fleet.RegisterInto(host);

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
                        /*
                         * Asked at ACTIVATION, not at registration. Register runs
                         * during LOADING, when Kerbalism's own settings may not be
                         * parsed yet, so a check here would read whatever happened
                         * to be true that early and pin it for the session. The
                         * factory runs when the capability resolves, by which time
                         * the setting is real.
                         *
                         * Returning null is a DECLINE: the Kernel skips this
                         * provider, notices `provider-declined`, and falls through
                         * to whatever else can serve. Holding an exclusive
                         * capability while modelling nothing starves every provider
                         * below it.
                         */
                        Factory = _ =>
                            KerbalismReliabilityBackend.CanServe(_k)
                                ? new KerbalismReliabilityBackend(_k)
                                : null,
                    });
                }
                catch (Exception ex)
                {
                    // UnityEngine.Debug, not Console.Error: the latter is invisible
                    // in KSP, which is how a silently-dropped provider looked
                    // identical to an uninstalled mod. The Kernel emits no notice
                    // for a provider that never registered, so this uplink's own
                    // Health() below is the only route by which the two differ.
                    _reliabilityRegistrationError = ex.Message;
                    UnityEngine.Debug.LogError(
                        "[Gonogo] KerbalismUplink could not register reliability provider: " + ex.Message);
                }

                RegisterScience(host);
                RegisterIsru(host);
                RegisterFileManagerCommands(host);

                // Attach the currency-delay science hook. Kerbalism credits science through a
                // pooled, vessel-less buffer the stock currency interceptor can't see, so this
                // presence-gated Harmony postfix is the only way that science gets delayed. The
                // hook forwards to whatever the "delayedScience" capability elects, resolved
                // through the Kernel handed in here; if the core scenario isn't active the forward
                // is a silent no-op.
                try
                {
                    _scienceHook.TryAttach(host.Kernel);
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("[KerbalismUplink] could not attach currency-delay science hook: " + ex.Message);
                }
            }
        }

        /// <summary>
        /// Register Kerbalism as the "isru" provider, above the stock vanilla backend
        /// so it WINS when Kerbalism is installed. Same registering-is-the-gate rule
        /// as reliability above, and the same two-pass guarantee: the capability is
        /// owned and declared by IsruCoreUplink (bundled core) in the pre-Register
        /// pass, so it exists here regardless of assembly-scan order.
        ///
        /// <para>Unlike science, this provider needs no capture source of its own:
        /// IsruCoreUplink calls the elected backend from ITS main-thread capture, so
        /// the reads are already on the right thread and the factory can simply
        /// construct rather than hand back a fed instance.</para>
        /// </summary>
        private void RegisterIsru(IUplinkHost host)
        {
            try
            {
                host.Kernel.RegisterProvider(new ProviderRegistration
                {
                    Capability = "isru",
                    Id = KerbalismIsruMap.ProviderId,
                    // Above the stock vanilla backend: Kerbalism's patches delete the
                    // stock harvester and converter modules, so losing this election
                    // would mean an empty ISRU dashboard, not a degraded one.
                    Priority = 1.0,
                    Factory = _ => new KerbalismIsruBackend(_k),
                });
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[KerbalismUplink] could not register isru provider: " + ex.Message);
            }
        }

        /// <summary>
        /// Wire the five File Manager commands to <see cref="KerbalismFileCommandProvider"/>'s
        /// KSP-free handlers, each closed over <see cref="_fileActuator"/> (the
        /// live Drive) and the science backend's latest capture (the
        /// pre-filter snapshot; see <see cref="KerbalismScienceBackend.Latest"/>).
        /// Called only inside the <c>if (_k.IsAvailable)</c> guard in
        /// <see cref="Register"/>, after <see cref="RegisterScience"/> has
        /// already wired the capture that feeds that snapshot.
        ///
        /// <para>The verbs here read that snapshot on the Courier thread, so it
        /// has to be true whether or not anything is watching a science channel.
        /// That is why the capture feeding it is registered UNGATED: the gated
        /// overload would skip it in an unwatched session, leaving the pre-filter
        /// empty and every verb refusing with ModeUnavailable, which asserts
        /// Kerbalism is not modelling science about an install that is.</para>
        /// </summary>
        private void RegisterFileManagerCommands(IUplinkHost host)
        {
            host.AddCommandHandler<KerbalismSubjectFlagArgs, CommandResult>(
                KerbalismFileCommandProvider.SendCommand,
                args => KerbalismFileCommandProvider.HandleSend(_fileActuator, _science.Latest, args));
            host.AddCommandHandler<KerbalismSubjectActionArgs, CommandResult>(
                KerbalismFileCommandProvider.DeleteCommand,
                args => KerbalismFileCommandProvider.HandleDelete(_fileActuator, _science.Latest, args));
            host.AddCommandHandler<KerbalismSubjectFlagArgs, CommandResult>(
                KerbalismFileCommandProvider.AnalyzeCommand,
                args => KerbalismFileCommandProvider.HandleAnalyze(_fileActuator, _science.Latest, args));
            host.AddCommandHandler<KerbalismSubjectActionArgs, CommandResult>(
                KerbalismFileCommandProvider.DumpCommand,
                args => KerbalismFileCommandProvider.HandleDump(_fileActuator, _science.Latest, args));
            host.AddCommandHandler<KerbalismSubjectActionArgs, CommandResult>(
                KerbalismFileCommandProvider.MoveToLabCommand,
                args => KerbalismFileCommandProvider.HandleMoveToLab(_fileActuator, _science.Latest, args));
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

            /*
             * UNGATED deliberately, and it must stay that way. The gated
             * overload skips the capture entirely while nothing under the
             * prefix is watched, which is safe only when a capture's whole
             * effect is its return value. This one's is not: the Courier
             * handler stashes into the science backend, and the five File
             * Manager verbs read that stash as their pre-filter. Gated, an
             * unwatched session left the stash empty and every verb refused
             * with ModeUnavailable, which asserts Kerbalism is not modelling
             * science about an install that is.
             *
             * The channels cost nothing extra for this: the engine samples a
             * channel source only when it is subscribed, so the publish side
             * is still demand-driven. What the ungating buys is a stash that
             * is true whether or not anyone happens to be watching.
             */
            host.AddSampledSource(CaptureScienceOnMain, HandleScienceOnCourier);
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
        private object? CaptureOnMain(KspSnapshot? snapshot) =>
            CaptureVessel(FlightGlobals.ActiveVessel, snapshot?.Ut ?? 0.0);

        /// <summary>
        /// MAIN-THREAD capture of ONE craft, active or not. Every read here
        /// answers for an unloaded vessel as well as a loaded one: Kerbalism's
        /// resource cache walks proto part snapshots when the parts are gone,
        /// its habitat info has an unloaded mode of its own, and the per-kerbal
        /// rule accumulators are advanced by the vessel's own background turn.
        ///
        /// <para>The one exception is the process list, which lives on the part
        /// modules KSP discards on unload, so it is left NULL rather than empty
        /// for a background craft: see <c>KerbalismLifeSupport.Processes</c> for
        /// why the difference is load-bearing.</para>
        ///
        /// <para><see cref="KerbalismCaptured.AsOfUt"/> carries when Kerbalism
        /// last recomputed all this, which for a background craft is not now:
        /// unloaded vessels take their turns one per tick, in rotation.</para>
        /// </summary>
        internal KerbalismCaptured? CaptureVessel(Vessel v, double ut)
        {
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
            var modifierCtx = _k.BeginModifierContext(v);
            List<ProcessRaw>? processes = null;
            if (v.loaded)
            {
                processes = new List<ProcessRaw>(_k.Processes(v));
                ApplyProcessEnvModifiers(_k, processes, profile, v, modifierCtx);
            }

            var sinceEval = _k.SecondsSinceLastEvaluation(v);

            var crew = new List<KerbalRulesRaw>(_k.CrewRules(v));
            _k.FillRuleVarianceFactors(v, profile.Rules, crew);

            return new KerbalismCaptured
            {
                Ut = ut,
                Snapshot = s,
                Processes = processes,
                Crew = crew,
                RuleConstants = _k.RuleConstants(),
                Solar = _k.Solar(v),
                StormEjectionSpeed = _k.StormEjectionSpeed(),
                RuleEnvModifiers = RuleEnvModifiers(profile, v, modifierCtx),
                AsOfUt = sinceEval.HasValue ? ut - sinceEval.Value : (double?)null,
                Rules = profile.Rules,
                RuleInputAmounts = RuleInputAmounts(profile, R),
            };
        }

        /// <summary>
        /// Joins each captured process instance onto its profile Process definition
        /// by the pseudo-resource token (entry.Resource), then evaluates Kerbalism's
        /// live modifier product over that definition's modifiers MINUS the join
        /// token itself (already accounted for via Capacity; see
        /// KerbalismProcessEntry.EnvModifier's doc comment for why it must be
        /// excluded). Mutates each ProcessRaw in place.
        ///
        /// <para>Static and internal because the ISRU backend needs the identical
        /// join: its converter rates are the same processes scaled by the same live
        /// product, and two copies of this would drift into two different numbers for
        /// one part.</para>
        /// </summary>
        internal static void ApplyProcessEnvModifiers(
            KerbalismReflection k,
            List<ProcessRaw> processes,
            ProfileRaw profile,
            Vessel v,
            KerbalismReflection.ModifierContext? ctx)
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
                p.EnvModifier = k.EvaluateModifiers(ctx, v, filtered);
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
        /// <summary>
        /// The amount held of each resource a RULE consumes, which is what the
        /// death clock's first stage needs (how long until degeneration starts)
        /// and the only reason amounts are read at all: the life-support channel
        /// deliberately carries rates only, because <c>vessel.resources</c>
        /// already carries amounts for the active craft. Rule inputs rather than
        /// every profile resource, so the read stays a handful of lookups.
        /// </summary>
        private static Dictionary<string, double> RuleInputAmounts(ProfileRaw profile, Func<string, double> amount)
        {
            var map = new Dictionary<string, double>(StringComparer.Ordinal);
            foreach (var rule in profile.Rules)
            {
                if (rule == null || rule.Input.Length == 0 || map.ContainsKey(rule.Input)) continue;
                map[rule.Input] = amount(rule.Input);
            }
            return map;
        }

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
                KerbalismCapture.BuildLifeSupport(c.Snapshot, c.Processes, c.Snapshot.Rates, c.RuleEnvModifiers, c.AsOfUt),
                c.Ut);
            _crew?.Publish(
                KerbalismCapture.BuildCrew(c.Crew, c.RuleConstants, c.AsOfUt, c.DeathClocks()), c.Ut);
        }

        /// <summary>Why the reliability provider is not registered, when registration itself threw. See the catch that sets it.</summary>
        private string? _reliabilityRegistrationError;

        public UplinkHealth Health()
        {
            if (!_k.IsAvailable)
            {
                return new UplinkHealth(UplinkHealthState.Unavailable, "Kerbalism assembly not loaded");
            }
            if (_reliabilityRegistrationError != null)
            {
                return new UplinkHealth(
                    UplinkHealthState.Degraded,
                    "reliability provider registration threw: " + _reliabilityRegistrationError);
            }
            return UplinkHealth.Healthy;
        }

        /// <summary>Plain cross-thread bundle: no live KSP references.</summary>
        internal sealed class KerbalismCaptured
        {
            public double Ut;
            public KerbalismSnapshot Snapshot;

            /// <summary>Null for a background craft, whose part modules KSP has discarded: absent, not empty.</summary>
            public List<ProcessRaw>? Processes;
            public List<KerbalRulesRaw> Crew = new();
            public IReadOnlyDictionary<string, RuleConstants> RuleConstants = new Dictionary<string, RuleConstants>();
            public SolarRaw Solar = new();
            public double? StormEjectionSpeed;
            public IReadOnlyDictionary<string, double> RuleEnvModifiers = new Dictionary<string, double>();

            /// <summary>When Kerbalism last recomputed this, null when unreadable, never the read time standing in.</summary>
            public double? AsOfUt;

            /// <summary>The loaded profile's rule definitions, carried so the deadline can be derived off-thread.</summary>
            public List<RuleDefRaw> Rules = new();

            /// <summary>Units held of each rule INPUT resource: the death clock's first stage.</summary>
            public IReadOnlyDictionary<string, double> RuleInputAmounts = new Dictionary<string, double>();

            /// <summary>
            /// Kerbal name -> soonest fatal deadline in seconds, null where not
            /// derivable. Derived rather than read, so it is computed once on the
            /// Courier thread by <see cref="DeathClocks"/> and shared by every
            /// publisher of this bundle.
            /// </summary>
            public IReadOnlyDictionary<string, double?> DeathClocks()
            {
                var map = new Dictionary<string, double?>(Crew.Count, StringComparer.Ordinal);
                foreach (var k in Crew)
                {
                    if (k == null || string.IsNullOrEmpty(k.Name)) continue;
                    map[k.Name] = KerbalismDeathClock.SoonestFatalSeconds(
                        k, Rules, RuleEnvModifiers, RuleInputAmounts, Snapshot.Rates);
                }
                return map;
            }
        }
    }
}
