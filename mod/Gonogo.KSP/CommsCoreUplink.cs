using System;
using System.Collections.Generic;
using System.Globalization;
using Gonogo.KSP.CommandCentres;
using Gonogo.KSP.SilenceTracking;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.CommandCentres;
using Sitrep.Host.Comms;
using Sitrep.Host.Settings;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The bundled core comms registration (comms-uplink-design.md §2.2, §6):
    /// it owns the exclusive <c>"comms"</c> capability (registering
    /// <see cref="CommNetBackend"/> as the always-present vanilla factory),
    /// declares the shared always-present link channels and the core
    /// <c>comms.delay</c> channel once, and sources them from
    /// whichever backend the election picked: resolved at capture time via
    /// <c>host.Kernel.Query&lt;ICommsBackend&gt;("comms")</c>. Neither CommNet
    /// nor RealAntennas declares these channels itself; that is the
    /// shared-namespace-single-declaration rule (§5).
    ///
    /// <para><c>comms.path</c>, <c>comms.network</c> and
    /// <c>comms.commandCentre</c> are not published from here. The elected
    /// backend's solved path is every hop's state at this instant, so each
    /// command centre is sent the path its own contact plan has instead
    /// (<see cref="CentrePath"/>). The solved path is still read here, for the
    /// signal delay the delay ledger is written from.</para>
    ///
    /// <para>The elected backend reads live KSP, so every read happens in the
    /// capture-on-main sampler (<see cref="CaptureOnMain"/>): the same F1 seam
    /// GonogoScansatUplink uses. The Courier-side handle
    /// (<see cref="HandleOnCourier"/>) only publishes the plain captured
    /// payloads. <c>comms.delay</c> is computed by the core
    /// <see cref="SignalDelay"/> math from the captured hop geometry, gonogo's
    /// own signal delay computation, not a backend accessor (§3.1).</para>
    ///
    /// <para><b>Health:</b> implements <see cref="ISitrepUplink.Health"/>:
    /// the second real implementation after
    /// <c>Gonogo.KerbcastUplink.KerbcastUplink</c>, and "zero new plumbing":
    /// <see cref="Health"/> reuses the exact same <see cref="CommsElection.Elected"/>
    /// read <see cref="ComputeConnectedOnMain"/>/<see cref="ComputeDelayOnMain"/>/
    /// <see cref="CaptureOnMain"/> already perform. The state machine itself is
    /// <see cref="CommsHealth"/>: a pure function, headless-tested in
    /// <c>Sitrep.Host.Tests</c> (see that type's doc comment for why it lives
    /// in <c>Sitrep.Host.Comms</c> rather than here).</para>
    /// </summary>
    [SitrepUplink("comms")]
    public sealed class CommsCoreUplink : ISitrepUplink, IUplinkCapabilityDeclarer, IModSettingsSource, IModSettingsWriter
    {
        public const string ConnectivityTopic = "comms.connectivity";
        public const string SignalTopic = "comms.signal";
        public const string ControlTopic = "comms.control";
        public const string DelayTopic = "comms.delay";

        /// <summary>
        /// The elected backend's declared occlusion geometry, resolved per body
        /// (see <see cref="Sitrep.Contract.CommsOcclusion"/>). Sourced the same
        /// way as every other shared channel here: from whichever backend the
        /// election picked, so a consumer asking "what radius of this body
        /// blocks a radio path" never has to know whether RealAntennas is
        /// installed.
        /// </summary>
        public const string OcclusionTopic = "comms.occlusion";

        /// <summary>
        /// The elected backend's declared grading of the active vessel's link:
        /// one 0..1 rating with the rule that produced it named alongside (see
        /// <see cref="Sitrep.Contract.CommsDegrade"/>). Sourced the same way as
        /// every other shared channel here.
        ///
        /// <para>It exists so a consumer choosing a quality (a video feed's
        /// bitrate, a voice channel's noise) has one number that means the same
        /// kind of thing on every install. <c>comms.signal</c> cannot
        /// serve: it carries KSP's signal strength under stock and a rate-ladder
        /// position under RealAntennas, so the <c>1 - strength</c> a
        /// consumer would otherwise write is a different curve per save with
        /// nothing on the wire saying so.</para>
        ///
        /// <para>Delayed, because it is an
        /// observation of the craft's link rather than a fact the command centre
        /// knows independently: a degradation should reach the operator one
        /// signal delay after it happened, alongside the telemetry that suffered
        /// it. Freeze-gated on the ordinary terms; the disconnect edge reaches a
        /// client on <see cref="LinkTopic"/>, which is exempt from that freeze
        /// precisely so it can report it.</para>
        /// </summary>
        public const string DegradeTopic = "comms.degrade";

        /// <summary>
        /// The client-facing connectivity MetaTopic (comms-delay-model-
        /// consistency spec): a Delayed channel the engine special-cases as
        /// freeze-EXEMPT (see <see cref="Sitrep.Host.ChannelEngine.ConnectivityMetaTopic"/>,
        /// which this literal must match, and <see cref="Sitrep.Contract.CommsLink"/>).
        /// It carries the same link up/down the <c>comms.connectivity</c>
        /// observation channel does, but Delayed + freeze-exempt so the
        /// disconnect edge escapes the reveal-gate freeze and reaches the client
        /// (revealed at the last-known signal delay horizon), where a plain
        /// Delayed channel would freeze at last-known and the client's
        /// "NO SIGNAL" could never fire. Sourced from the same
        /// <see cref="CaptureOnMain"/> connectivity read that drives the freeze
        /// gate, so the client-visible link state and the gate can never
        /// disagree. This is the connectivity channel clients should read
        /// (via the <c>comm.connected</c> mapped key / <c>comms.link.connected</c>).
        /// </summary>
        public const string LinkTopic = "comms.link";

        // The authored choice before any save is read: delay on at real light
        // speed, which is also what a save that holds no Gonogo section loads.
        private static SignalDelayConfig _signalDelayConfig = new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };

        /// <summary>The block of <c>gonogo.cfg</c> that held the signal delay choice before it moved into the save.</summary>
        internal const string LegacySignalDelayBlock = "SIGNAL_DELAY";

        /// <summary>
        /// Say once, when <c>gonogo.cfg</c> still carries the signal delay
        /// block, that the choice now lives in the save and is not read from the
        /// file.
        /// </summary>
        public static void NoteLegacySettings(SettingsStore store, Action<string> log)
        {
            if (store == null)
            {
                throw new ArgumentNullException(nameof(store));
            }

            if (store.Text(LegacySignalDelayBlock + "/enabled") != null
                || store.Text(LegacySignalDelayBlock + "/lightSpeedScale") != null)
            {
                log("gonogo.cfg holds a SIGNAL_DELAY block, which is no longer read: signal delay is now set per save, "
                    + "under Difficulty settings, Gonogo, or in the Gonogo app's Uplinks settings");
            }
        }

        private static readonly CommsDelayModSettings DelayModSettings = new CommsDelayModSettings(
            unavailable: () => SaveChoice.Unavailable(),
            read: () => SaveChoice.Read(),
            write: choice => SaveChoice.Write(choice));

        public IReadOnlyList<ModSetting> ListModSettings() => DelayModSettings.ListModSettings();

        public ModSettingValue ReadModSetting(string id) => DelayModSettings.ReadModSetting(id);

        public CommandResult WriteModSetting(string id, ModSettingValue value) => DelayModSettings.WriteModSetting(id, value);

        /// <summary>
        /// Take the save's signal delay choice into force. Called every frame
        /// from the main thread: it does nothing unless the save's choice
        /// differs from the one in force, and keeps the choice in force while no
        /// game is loaded.
        /// </summary>
        public static void SyncSignalDelayFromSave()
        {
            var choice = SaveChoice.Read();
            if (!choice.HasValue)
            {
                return;
            }

            var held = _signalDelayConfig;
            if (held.Enabled == choice.Value.Enabled && held.LightSpeedScale == choice.Value.LightSpeedScale)
            {
                return;
            }

            ConfigureSignalDelay(new SignalDelayConfig
            {
                Enabled = choice.Value.Enabled,
                LightSpeedScale = choice.Value.LightSpeedScale,
                SilenceDeclarationSeconds = held.SilenceDeclarationSeconds,
            });
        }

        private static class SaveChoice
        {
            internal static string? Unavailable() =>
                Node() == null ? "no save is loaded" : null;

            internal static SignalDelayChoice? Read()
            {
                var node = Node();
                if (node == null)
                {
                    return null;
                }

                return new SignalDelayChoice(node.signalDelay, CommsDelayModSettings.HeldLightSpeed(node.lightSpeedScale));
            }

            internal static bool Write(SignalDelayChoice choice)
            {
                var node = Node();
                if (node == null)
                {
                    return false;
                }

                node.signalDelay = choice.Enabled;
                node.lightSpeedScale = (float)choice.LightSpeedScale;
                SyncSignalDelayFromSave();
                return true;
            }

            private static GonogoGameParameters? Node()
            {
                try
                {
                    return HighLogic.CurrentGame?.Parameters?.CustomParams<GonogoGameParameters>();
                }
                catch (Exception ex)
                {
                    GonogoLog.Warn("comms", "the signal delay setting could not be read from the save: " + ex.Message);
                    return null;
                }
            }
        }

        /// <summary>
        /// Apply a SignalDelay config directly, which is what a settings commit
        /// does: its switch and its light-speed scale become this uplink's own
        /// two delay modifiers, beside any an Uplink holds.
        /// </summary>
        public static void ConfigureSignalDelay(SignalDelayConfig config)
        {
            var before = DelayFactor(_signalDelayConfig);
            _signalDelayConfig = config ?? SignalDelayConfig.Off();
            var after = DelayFactor(_signalDelayConfig);
            _base = new SignalDelayConfig
            {
                Enabled = true,
                LightSpeedScale = 1.0,
                SilenceDeclarationSeconds = _signalDelayConfig.SilenceDeclarationSeconds,
            };
            HoldSettingsModifiers(_delayModifiers);
            if (before > 0.0 && after < before)
            {
                DelayShortened?.Invoke(after / before);
            }
        }

        // What every signal delay is multiplied by under a config: nothing when switched off, the inverse of the light speed otherwise.
        private static double DelayFactor(SignalDelayConfig config) =>
            config.Enabled && config.LightSpeedScale > 0.0 ? 1.0 / config.LightSpeedScale : 0.0;

        /// <summary>
        /// Raised when the signal delay choice makes every delay shorter, with the
        /// fraction of what is left of any delay still running that remains: 0 when
        /// delay is switched off, 0.5 when the light speed doubles.
        /// </summary>
        internal static event Action<double>? DelayShortened;

        /*
         * The modifiers every delay reader's config is folded through: the
         * host's own once Register has run, and a private set before that, so a
         * settings commit at boot is in force from the first read. Static for
         * the same reason the config is, since five readers reach
         * SignalDelayConfig below with no instance of this uplink in hand.
         */
        private static DelayModifiers _delayModifiers = new DelayModifiers();

        // The delay config before any modifier, the settings' own included: on, at real light speed.
        private static SignalDelayConfig _base = new SignalDelayConfig { Enabled = true, LightSpeedScale = 1.0 };

        private static IDisposable? _switchModifier;
        private static IDisposable? _scaleModifier;

        // Holds the switched-off modifier the authored default above implies, until a settings commit replaces it.
        static CommsCoreUplink() => HoldSettingsModifiers(_delayModifiers);

        /// <summary>
        /// Fold the delay config through <paramref name="modifiers"/> from now
        /// on, carrying this uplink's own settings modifiers across. Called from
        /// <see cref="Register"/> with the host's set; internal so a test can
        /// drive the composition without a live engine, and can put it back.
        /// </summary>
        internal static void UseDelayModifiers(DelayModifiers modifiers)
        {
            if (modifiers == null)
            {
                throw new ArgumentNullException(nameof(modifiers));
            }
            if (ReferenceEquals(modifiers, _delayModifiers))
            {
                return;
            }

            var previousSwitch = _switchModifier;
            var previousScale = _scaleModifier;
            _switchModifier = null;
            _scaleModifier = null;
            HoldSettingsModifiers(modifiers);
            _delayModifiers = modifiers;
            previousSwitch?.Dispose();
            previousScale?.Dispose();
        }

        /// <summary>The modifiers the delay config is folded through now.</summary>
        internal static DelayModifiers DelayModifiersInForce => _delayModifiers;

        /*
         * The settings as modifiers: switched off is a factor of 0, and a light
         * speed of s times c is a factor of 1/s on every light-time. Each is
         * replaced in one step, so a reader on another thread never sees the old
         * one withdrawn before the new one is held.
         */
        private static void HoldSettingsModifiers(DelayModifiers modifiers)
        {
            var authored = _signalDelayConfig;
            _switchModifier = Hold(
                modifiers,
                _switchModifier,
                authored.Enabled ? (double?)null : 0.0,
                "signal delay is switched off in the settings");

            var scale = authored.LightSpeedScale;
            _scaleModifier = Hold(
                modifiers,
                _scaleModifier,
                scale > 0.0 && scale != 1.0 ? 1.0 / scale : (double?)null,
                "light speed is set to " + scale.ToString("R", CultureInfo.InvariantCulture) + " c in the settings");
        }

        private static IDisposable? Hold(DelayModifiers modifiers, IDisposable? held, double? factor, string reason)
        {
            if (factor == null)
            {
                held?.Dispose();
                return null;
            }
            return modifiers.Replace(held, factor.Value, reason);
        }

        // Whether this save models a comms network. Held behind a delegate
        // because the delay accessor
        // below is read by five surfaces without an instance of this uplink in
        // hand, and the read underneath it goes through HighLogic.CurrentGame,
        // which is a property over a MonoBehaviour singleton and therefore
        // answers null in every headless process no matter what a test sets.
        // The seam is what lets the COMPOSITION here be exercised at all; the
        // live read itself is CommsModelPresence.Present and is only reachable
        // in a running KSP.
        private static Func<bool?> _commsModelProbe = () => CommsModelPresence.Present;

        /// <summary>Point the no-comms-model rule at a different answer; pass null to put the live read back.</summary>
        internal static void ConfigureCommsModelProbe(Func<bool?>? probe) =>
            _commsModelProbe = probe ?? (() => CommsModelPresence.Present);

        // Which craft is on screen, for every route this uplink asks the backend
        // about. A delegate for the same reason _commsModelProbe is: the live
        // read goes through FlightGlobals, which a headless process cannot touch
        // at all, and without the seam no path through here could be driven.
        private static Func<Vessel?> _activeVesselProbe = () => ActiveVesselScope.Current;

        /// <summary>Point the active-craft read at a different answer; pass null to put the live read back.</summary>
        internal static void ConfigureActiveVesselProbe(Func<Vessel?>? probe) =>
            _activeVesselProbe = probe ?? (() => ActiveVesselScope.Current);

        private static bool? CommsModelPresent
        {
            get
            {
                try
                {
                    return _commsModelProbe();
                }
                catch (Exception)
                {
                    return null;
                }
            }
        }

        /// <summary>
        /// The signal-delay config in force, so every delay reader (the reveal
        /// gate, comms.delay, fleet signal delay, the command-centre pass and the
        /// currency deadline) uses one answer.
        ///
        /// <para>Effective, not authored: every delay modifier in force is
        /// folded in, the settings' own switch and light-speed scale among
        /// them, and a save that models no comms network at all cuts delay
        /// outright. Deriving both here is what makes every one of those
        /// readers agree rather than leaving a board whose telemetry is live and
        /// whose money still arrives late. See <see cref="DelayModifiers"/> and
        /// <see cref="CommsModelPolicy"/>.</para>
        ///
        /// <para>The no-comms-model cut is applied second so it carries its
        /// reason whatever the modifiers say (see
        /// <see cref="SignalDelayConfig.CutForNoCommsModel"/>).</para>
        /// </summary>
        internal static SignalDelayConfig SignalDelayConfig =>
            CommsModelPolicy.Effective(
                _delayModifiers.Apply(_base),
                CommsModelPresent);

        /// <summary>The config as the settings author it, before any modifier: what the settings rows say.</summary>
        internal static SignalDelayConfig AuthoredSignalDelayConfig => _signalDelayConfig;

        // Held the same way as _signalDelayConfig above: the command-centre registry GonogoAddon builds after uplink discovery, for the readers that have no instance of this uplink in hand.
        private static CommandCentreRegistry? _commandCentreRegistry;

        /// <summary>Set the shared command-centre registry (called by GonogoAddon once the registry is built).</summary>
        public static void ConfigureCommandCentreRegistry(CommandCentreRegistry registry) =>
            _commandCentreRegistry = registry;

        /// <summary>The shared command-centre registry, or null before <see cref="GonogoAddon"/> has built it.</summary>
        internal static CommandCentreRegistry? CommandCentres => _commandCentreRegistry;

        private IChannelPublisher? _connectivity;
        private IChannelPublisher? _control;
        private IChannelPublisher? _link;
        private IChannelPublisher? _occlusion;

        private Kernel? _kernel;

        // The occlusion declaration is effectively static within a session (the
        // body set never changes; the stock multipliers change only if the player
        // edits the difficulty settings), so an unchanged one republishes the
        // SAME instance. ChannelEmitter's change-gate compares by equality, and a
        // wire POCO has none, so identity is what buys the suppression: holding
        // the instance costs a keyframe every 30 UT and nothing in between, where
        // a fresh-but-identical object each tick would push a full body list at
        // sample cadence. Late subscribers still get an immediate keyframe
        // (ChannelEmitter.NotifySubscribed), so the suppression is invisible.
        private CommsOcclusion? _lastOcclusion;

        private static ChannelDeclaration TrueNow(string topic) => new ChannelDeclaration
        {
            Kind = SampleKind.Discrete,
            Requires = Requirement.None,
            Topic = topic,
            Delivery = Delivery.LossyLatest,
            // Not an observation of a craft at all: the universe's geometry and the rule the backend applies to it. Nothing a light-time could carry.
            Delay = DelayRole.TrueNow,
            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
        };

        /// <summary>
        /// A report of the active craft's link itself: whether the radio is
        /// answering, how strong it is, what it may command. A centre learns
        /// whether a radio answers only when its signal arrives, so these are
        /// delayed on the craft's node, and the engine exempts them from the
        /// freeze by topic, as it does <c>comms.link</c>, because they are how
        /// the blackout is reported.
        /// </summary>
        private static ChannelDeclaration LinkReport(string topic) => new ChannelDeclaration
        {
            Kind = SampleKind.Discrete,
            Requires = Requirement.None,
            Topic = topic,
            Delivery = Delivery.LossyLatest,
            Delay = DelayRole.Delayed,
            Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
        };

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "comms",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                LinkReport(ConnectivityTopic),
                LinkReport(ControlTopic),
                // comms.delay, comms.signal and comms.degrade are not declared
                // here. Each command centre is sent its own by the contact plan
                // source, from what that centre has heard. This Uplink still
                // measures the delay over the game's own links for the engine's
                // ledger: see SetSignalDelaySource below.
                // comms.occlusion is TrueNow: it is not an observation of the
                // vessel at all but a statement about the universe's geometry and
                // the rule the elected backend applies to it. A delayed model
                // would have a predictor computing tomorrow's blackout from
                // yesterday's assumptions.
                TrueNow(OcclusionTopic),
                // comms.link: Delayed (rides the normal light-time horizon) but
                // the ENGINE special-cases it as freeze-EXEMPT by topic identity
                // (ChannelEngine.ConnectivityMetaTopic), because it is the
                // channel that REPORTS the blackout and so cannot be frozen by
                // it. Declared Delayed here for accuracy even though the
                // exemption itself is topic-identity-keyed, not a read of this
                // Delay disposition.
                new ChannelDeclaration
                {
                    Kind = SampleKind.Discrete,
                    Requires = Requirement.None,
                    Topic = LinkTopic,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.Delayed,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
            },
        };

        /// <summary>
        /// Two-pass fix (see <see cref="IUplinkCapabilityDeclarer"/>): the
        /// exclusive <c>"comms"</c> capability is declared here, in the pre-
        /// Register discovery pass, not in <see cref="Register"/>. That
        /// guarantees the capability exists before any uplink's
        /// <see cref="Register"/> runs, so RealAntennas' provider registration
        /// (a separate uplink, in its own <see cref="Register"/>) can never race
        /// ahead of this declaration and throw, regardless of assembly-scan
        /// discovery order. CommNet is the capability's always-present vanilla
        /// fallback; the engine calls <c>Kernel.Resolve()</c> once every uplink
        /// has registered its providers.
        ///
        /// <para>The exclusive <c>"homeCommand"</c> capability is declared here too,
        /// for the same two-pass reason: a mod's claimant registers from its own
        /// uplink's Register. It sits beside comms because its stock
        /// claimant decides from CommNet's home nodes.</para>
        /// </summary>
        public void DeclareCapabilities(Kernel kernel)
        {
            CommsElection.RegisterCapability(kernel, _ => new CommNetBackend());

            var stockHomes = new StockHomeNodeSource();
            HomeCommandElection.RegisterCapability(kernel, stockHomes.HomeFacts, SpaceCentreSite.Current);
        }

        public void Register(IUplinkHost host)
        {
            _host = host;
            _kernel = host.Kernel;

            // The host's delay modifiers, which an Uplink holds through
            // IUplinkHost.RegisterDelayModifier and every delay reader sees
            // through SignalDelayConfig above.
            if (host is IDelayModifierSource source)
            {
                UseDelayModifiers(source.DelayModifiers);
            }

            _connectivity = host.Publisher(ConnectivityTopic);
            _control = host.Publisher(ControlTopic);
            _link = host.Publisher(LinkTopic);
            _occlusion = host.Publisher(OcclusionTopic);

            host.AddSampledSource(
                CaptureOnMain,
                HandleOnCourier,
                ConnectivityTopic,
                ControlTopic,
                LinkTopic,
                OcclusionTopic);

            // Advertise comms.delay to the engine's server-side reveal gate as
            // the AUTHORITATIVE, subscription-independent delay source (§7.3
            // Step 2). Without this the gate only ever learned the delay from a
            // pull-style AddChannelSource (which comms.delay is NOT, it rides
            // the main-thread capture above) or the subscription-gated wire
            // snoop, so a Delayed channel was delivered live whenever no client
            // subscribed comms.delay. This closure is evaluated on the MAIN
            // thread every tick (same seam as CaptureOnMain), so reading the
            // live elected backend is safe.
            host.SetSignalDelaySource(ComputeDelayOnMain);

            // The DROP EVENT, off the same elected backend and the same tick.
            // The delay above says how far away the craft is; this says when a
            // hop it was routing through stopped carrying, which is the only
            // thing that can retire telemetry already in flight behind a relay
            // that died. See IUplinkHost.SetPathBreakSource and PathBreakWatch.
            host.SetPathBreakSource(ObservePathBreakOnMain);

            // Freeze-on-disconnect: advertise the CONNECTED/DISCONNECTED state to
            // the reveal gate the SAME subscription-independent, main-thread way
            // as the delay. When the control link is down, the gate withholds
            // (freezes) every Delayed channel instead of revealing it live off a
            // zero/None delay; on reconnect it replays what it held. See
            // IUplinkHost.SetConnectivitySource.
            host.SetConnectivitySource(ComputeConnectedOnMain);

            // The ground's forecast for each craft it loses, which the home
            // centre judges a craft lost by. Registered on this uplink's pass
            // because the forecast rests on the comms model's geometry.
            new SilenceForecasts().RegisterInto(host);
        }

        /// <summary>
        /// The elected backend as every comms reader in this uplink must see
        /// it: wrapped by <see cref="CommsModelPolicy"/> when this save models
        /// no comms network, so the reveal gate's connectivity source, the
        /// comms.* channels and the delay source cannot disagree about whether
        /// there is a link. Null pre-election, exactly as
        /// <see cref="CommsElection.Elected"/> is.
        ///
        /// <para>MAIN-THREAD: the wrap reads the live difficulty option and, in
        /// the wrapped case, the active craft, so it belongs on the same
        /// capture-on-main seam every backend read already does.</para>
        /// </summary>
        internal ICommsBackend? ElectedBackend() =>
            CommsModelPolicy.Effective(
                _kernel != null ? CommsElection.Elected(_kernel) : null,
                CommsModelPresent,
                CommsModelPresence.LocalControl,
                CommsModelPresence.Meta);

        /// <summary>
        /// MAIN-THREAD connectivity computation for the engine's reveal gate (see
        /// <see cref="IUplinkHost.SetConnectivitySource"/>): reads the elected
        /// backend's <see cref="ICommsBackend.Connectivity"/> live, exactly where
        /// <see cref="CaptureOnMain"/>/<see cref="ComputeDelayOnMain"/> run.
        /// Returns null pre-election (no backend) and while no craft is on screen,
        /// which the gate treats as "no authority" and leaves the last-known
        /// state untouched (default connected): never worse than today's LAN
        /// behaviour.
        /// </summary>
        internal bool? ComputeConnectedOnMain(KspSnapshot? snapshot)
        {
            /*
             * With no craft on screen (an editor, the Space Center) there is no
             * link to be down, but the backend's read of "no craft" is a
             * disconnected one, and the gate freezes every Delayed channel on a
             * disconnect. A flight reverted to the editor would then have its
             * flight.ended held until a launch reloaded the game and dropped
             * it. No answer leaves the last-known state in force. A forced
             * blackout is about a craft too, so this precedes the dev override.
             */
            if (_activeVesselProbe() == null)
            {
                return null;
            }

            // DEV-ONLY: see DevCommsOverride's doc comment. Resolves to null
            // (no-op) unless the GonogoDevTools assembly is loaded in this
            // process, so a real player install always falls through to the
            // real elected backend below, unchanged. When armed, this takes
            // priority over the real backend so a forced blackout reliably
            // freezes the reveal gate (SetConnectivitySource) even while a
            // real link is up - the whole point of a deterministic test
            // fixture instead of waiting on real occlusion/range.
            var devOverride = DevCommsOverride.Current;
            if (devOverride.HasValue)
            {
                return devOverride.Value;
            }

            var backend = ElectedBackend();
            if (backend == null)
            {
                return null;
            }

            // A transient backend-read THROW must NOT be swallowed into a hard
            // `false`. The reveal gate treats a `false` from this source as an
            // AUTHORITATIVE disconnect and FREEZES every Delayed channel, so a
            // scene-settle / vessel-unload / vessel-change tick where the read
            // throws (e.g. CommNetBackend's un-guarded Meta() dereferencing a
            // torn ActiveVessel) would wrongly freeze ALL vessel.* telemetry,
            // even though the link is up. Worse, the comms.connectivity CHANNEL
            // fail-softs the SAME throw the opposite way (its capture returns
            // null ⇒ keeps last-known `connected:true`), so the two diverge:
            // the channel reads connected while the gate stays frozen, the
            // exact live-KSP symptom.
            //
            // Let the throw PROPAGATE instead. The engine's recoverable
            // connectivity fail-soft (ChannelEngine.CaptureConnectivityOnMain →
            // RefreshConnectivityFromCapability) treats a thrown source as
            // CONNECTED and retries next tick: matching the reveal gate's own
            // documented "a source that threw ⇒ treated as CONNECTED" contract
            // and never worsening LAN behaviour. A GENUINE disconnect still
            // arrives as a clean `false` (Connection() null ⇒ Connected=false,
            // no throw) and still freezes, as intended.
            return backend.Connectivity().Connected;
        }

        /// <summary>
        /// MAIN-THREAD delay computation for the engine's reveal gate (see
        /// <see cref="IUplinkHost.SetSignalDelaySource"/>): the same elected-
        /// backend resolution + core <see cref="SignalDelay"/> signal delay math
        /// <see cref="CaptureOnMain"/> performs for the <c>comms.delay</c>
        /// channel, factored out so the gate and the channel share one
        /// computation. Returns null pre-election (no backend), which the gate
        /// treats as "no delay authority yet" and leaves the last-known delay
        /// untouched.
        /// </summary>
        internal CommsDelay? ComputeDelayOnMain(KspSnapshot? snapshot)
        {
            var backend = ElectedBackend();
            if (backend == null)
            {
                return null;
            }

            // A transient backend-read THROW must PROPAGATE, not be swallowed
            // into a None result (OneWaySeconds null/0, per
            // CommsDelay.OneWaySeconds's typed-absence split). Dropping the
            // delay on a one-tick read blip would momentarily collapse the
            // reveal horizon and prematurely reveal a still-in-flight Delayed
            // sample. The
            // engine's recoverable delay fail-soft
            // (ChannelEngine.CaptureSignalDelayOnMain →
            // RefreshSignalDelayFromCapability → FailSoftSignalDelaySource)
            // instead leaves the LAST-KNOWN delay untouched and retries next
            // tick: the correct "never reveal earlier than the known horizon"
            // behaviour, symmetric with ComputeConnectedOnMain above.
            var active = _activeVesselProbe();
            var path = backend.Path(active);
            // The EFFECTIVE config, not the authored one: the reveal gate and
            // comms.delay itself must see every modifier the currency deadline
            // and the fleet's light-time see, or the gate holds telemetry for a
            // delay the rest of the board has already dropped.
            return SignalDelay.ComputeForCraft(
                SignalDelayConfig,
                path,
                SourceOf(active));
        }

        /*
         * The retained routes, one per craft, for the drop event. Per-uplink
         * rather than static: each is a comparison against the last tick, and two
         * elections or two saves must not compare against each other's geometry.
         */
        private readonly PathBreakWatchers _pathBreaks = new PathBreakWatchers();

        private IUplinkHost? _host;

        /// <summary>
        /// MAIN-THREAD break observation for the delay ledger (see
        /// <see cref="IUplinkHost.SetPathBreakSource"/>): the elected backend's
        /// route for each watched craft, put to <see cref="PathBreakWatchers"/>
        /// so the per-hop signal delays that <see cref="SignalDelay.Compute"/> sums
        /// away are seen by something before they are lost.
        ///
        /// <para>The craft on screen is always watched. Every other craft is
        /// watched while anything under <c>trackingStation.vessel.</c> is subscribed, the same
        /// condition the fleet capture runs on, because a break only retires
        /// samples someone is receiving and the fleet capture reads every
        /// vessel's route on those same ticks.</para>
        ///
        /// <para>Returns null pre-election, and forgets every retained route
        /// whenever delay is not being applied at all. A route retained across
        /// an off/on cycle would be compared against a situation it does not
        /// belong to, and two unrelated routes differ in every hop, which reads
        /// as a break on the deepest one.</para>
        /// </summary>
        internal IReadOnlyList<PathBreak>? ObservePathBreakOnMain(KspSnapshot? snapshot, double ut)
        {
            var backend = ElectedBackend();
            if (backend == null)
            {
                _pathBreaks.Forget();
                return null;
            }

            var config = SignalDelayConfig;
            if (config == null || !config.Enabled)
            {
                _pathBreaks.Forget();
                return null;
            }

            return _pathBreaks.Observe(WatchedCraft(backend), config.LightSpeedScale, ut);
        }

        /// <summary>
        /// The craft whose routes are watched this tick, each with every engine
        /// node its samples leave from: the craft on screen speaks through the
        /// active node and its own fleet node, every other craft through its
        /// fleet node alone.
        /// </summary>
        private IEnumerable<PathBreakWatchers.Subject> WatchedCraft(ICommsBackend backend)
        {
            var active = _activeVesselProbe();
            if (active != null)
            {
                var id = active.id.ToString();
                yield return Watched(backend, active, id, ChannelEngine.NodeId, ChannelEngine.FleetNodePrefix + id);
            }

            if (_host == null || !_host.IsAnyTopicSubscribed(SystemViewProvider.VesselPrefix))
            {
                yield break;
            }
            var all = FlightGlobals.Vessels;
            if (all == null)
            {
                yield break;
            }
            foreach (var vessel in all)
            {
                if (vessel == null || ReferenceEquals(vessel, active))
                {
                    continue;
                }
                var id = vessel.id.ToString();
                yield return Watched(backend, vessel, id, ChannelEngine.FleetNodePrefix + id);
            }
        }

        private static PathBreakWatchers.Subject Watched(
            ICommsBackend backend, Vessel vessel, string id, params string[] nodes) =>
            new PathBreakWatchers.Subject(
                id,
                nodes,
                backend.Path(vessel),
                nodeId => backend.StillCarriesTo(vessel, nodeId));

        /// <summary>
        /// MAIN-THREAD capture: resolves the elected backend and reads every
        /// shared readout (live KSP reads, safe here), then computes the core
        /// SignalDelay from the captured hop geometry. Bundles plain payloads
        /// into a <see cref="CommsCapture"/>: no live KSP handles cross to the
        /// Courier thread.
        /// </summary>
        internal object? CaptureOnMain(KspSnapshot? snapshot)
        {
            var backend = ElectedBackend();
            if (backend == null)
            {
                return null; // election not resolved / no backend (pre-flight)
            }

            try
            {
                var active = _activeVesselProbe();
                if (active == null)
                {
                    // No craft is on screen (an editor, the space centre, the
                    // tracking station): a link report is about a craft, so
                    // there is nothing to report. The occlusion rule is about
                    // the bodies and still goes out.
                    return new CommsCapture
                    {
                        Ut = snapshot?.Ut ?? Planetarium.GetUniversalTime(),
                        HasCraft = false,
                        Occlusion = OcclusionFor(backend, snapshot),
                    };
                }

                var path = backend.Path(active);
                var delay = SignalDelay.ComputeForCraft(
                    SignalDelayConfig,
                    path,
                    SourceOf(active));

                var connectivity = backend.Connectivity();

                // DEV-ONLY: mirror the same override ComputeConnectedOnMain
                // applies to the reveal gate into the comms.connectivity
                // CHANNEL payload too, so the app's own connectivity readout
                // agrees with the gate that is driving it - a forced
                // blackout that froze delayed channels while
                // comms.connectivity itself kept reporting "connected" would
                // be exactly the confusing half-state a real bug repro needs
                // to avoid. HasLocalControl is left untouched: local control
                // is a function of crew/probe core, not the comms link, so a
                // forced blackout should not also fake losing it.
                var devOverride = DevCommsOverride.Current;
                if (devOverride.HasValue)
                {
                    connectivity = new CommsConnectivity
                    {
                        Connected = devOverride.Value,
                        ControlSource = devOverride.Value ? connectivity.ControlSource : CommsControlSource.None,
                        HasLocalControl = connectivity.HasLocalControl,
                    };
                }

                return new CommsCapture
                {
                    Ut = snapshot?.Ut ?? Planetarium.GetUniversalTime(),
                    Connectivity = connectivity,
                    Signal = backend.Signal(),
                    Control = backend.ControlState(),
                    Delay = delay,
                    // The backend declares the RULE; the body list it applies to
                    // comes from the snapshot this capture was already handed
                    // (the same one trackingStation.bodies reads), so no backend has to
                    // walk FlightGlobals itself.
                    Occlusion = OcclusionFor(backend, snapshot),
                    // The backend declares the RULE and its own rating under it.
                    Degrade = DegradeFor(backend),
                };
            }
            catch (Exception)
            {
                // NULL-SAFE capture: a backend read that threw on a transient /
                // unloaded vessel yields no comms capture THIS tick (last-known
                // stays) rather than an exception that would fail-soft the whole
                // comms uplink. Retried next tick. The built-in CommNetBackend is
                // already exception-safe; this guards a third-party backend too.
                return null;
            }
        }

        /// <summary>
        /// MAIN-THREAD: the elected backend's declared occlusion model applied to
        /// the snapshot's body list. Rebuilding is cheap (a couple of dozen small
        /// objects), so it happens every tick and the result is compared to the
        /// last one; an unchanged declaration keeps the previous instance, which
        /// is what makes the emitter's change-gate suppress it. See
        /// <see cref="_lastOcclusion"/>.
        /// </summary>
        /// <summary>
        /// MAIN-THREAD: the elected backend's grading of the live link, as the
        /// payload its channel carries.
        ///
        /// <para>Guarded on its own, rather than under the whole capture's
        /// try/catch, because the two failures deserve different outcomes. The
        /// capture-wide guard drops the entire tick, which is right for a read
        /// that says whether there is a link at all; a grading that throws should
        /// cost the grading and nothing else, and dropping connectivity, path and
        /// delay because a third-party backend's quality rule failed would let an
        /// optional readout freeze the board. It comes back unrated, which is the
        /// contract's own way of saying nobody graded this.</para>
        /// </summary>
        /// <summary>
        /// The provenance a comms payload the uplink stamps itself carries: the
        /// craft the capture routed from, or <c>"game"</c> with none.
        /// </summary>
        private static string SourceOf(Vessel? active) =>
            active != null ? "vessel:" + active.id : "game";

        private static CommsDegrade DegradeFor(ICommsBackend backend)
        {
            ICommsDegradeModel model;
            try
            {
                model = backend.DegradeModel();
            }
            catch (Exception)
            {
                model = CommsDegradeModels.Unknown;
            }
            return CommsDegradeModels.ToPayload(model);
        }

        private CommsOcclusion OcclusionFor(ICommsBackend backend, KspSnapshot? snapshot)
        {
            var built = CommsOcclusionBuilder.Build(backend.OcclusionModel(), snapshot);
            if (_lastOcclusion != null && CommsOcclusionBuilder.SameDeclaration(_lastOcclusion, built))
            {
                return _lastOcclusion;
            }

            _lastOcclusion = built;
            return built;
        }

        /// <summary>COURIER-THREAD handle: publishes the captured payloads. No KSP access.</summary>
        internal void HandleOnCourier(object? captured)
        {
            if (captured is not CommsCapture capture)
            {
                return;
            }
            _occlusion?.Publish(capture.Occlusion, capture.Ut);
            if (!capture.HasCraft)
            {
                return;
            }

            _connectivity?.Publish(capture.Connectivity, capture.Ut);
            _control?.Publish(capture.Control, capture.Ut);
            // comms.link: the client-facing, freeze-exempt-Delayed connectivity
            // successor. Same Connected comms.connectivity carries,
            // but on the topic clients read so the disconnect edge survives the
            // reveal-gate freeze. See LinkTopic's doc comment.
            _link?.Publish(new CommsLink
            {
                Connected = capture.Connectivity.Connected,
                Meta = new PayloadMeta { Source = capture.Delay?.Meta?.Source ?? "game" },
            }, capture.Ut);
        }

        /// <summary>
        /// The mandatory healthcheck (see <see cref="ISitrepUplink.Health"/>):
        /// polled on the Courier thread every <c>system.uplinks</c> sample.
        /// Reuses <see cref="CommsElection.Elected"/>, the exact same pure
        /// <see cref="Kernel"/> lookup <see cref="ComputeConnectedOnMain"/> and
        /// <see cref="CaptureOnMain"/> already call: no live KSP/Unity read,
        /// so it is safe and cheap off the main thread. The state machine
        /// itself is <see cref="CommsHealth"/>.
        /// </summary>
        public UplinkHealth Health() =>
            CommsHealth.Evaluate(
                _kernel != null && CommsElection.Elected(_kernel) != null,
                CommsModelPresent,
                DevCommsOverride.ForcingBlackout);

        /// <summary>Plain cross-thread payload bundle: no live KSP references.</summary>
        private sealed class CommsCapture
        {
            public double Ut;
            public bool HasCraft = true;
            public CommsConnectivity Connectivity = new();
            public CommsSignal Signal = new();
            public CommsControl Control = new();
            public CommsDelay Delay = new();
            public CommsOcclusion Occlusion = new();
            public CommsDegrade Degrade = new();
        }
    }
}
