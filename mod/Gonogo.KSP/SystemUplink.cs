using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Core;
using Sitrep.Host;

namespace Gonogo.KSP
{
    /// <summary>
    /// The <c>system.bodies</c> retrofit: the reference
    /// <see cref="ISitrepUplink"/>, proving the uplink contract fits
    /// the exact channel <c>GonogoBodiesServer</c> used to hand-wire. See
    /// <c>local_docs/telemetry-mod/uplink-sdk-contract-design.md</c> §6.1
    /// (this class matches that sketch almost verbatim).
    ///
    /// Only ONE line of actual wiring survives the retrofit:
    /// <see cref="SystemViewProvider.BuildSystemBodies"/> drops straight in
    /// as the <see cref="IUplinkHost.AddChannelSource"/> mapper argument,
    /// unchanged. No <see cref="ISnapshotSampler"/> is registered because
    /// <c>KspHost.Sample</c> already populates the raw <c>"bodies"</c>
    /// snapshot key unconditionally (see its own doc comment), a future
    /// uplink whose data ISN'T already on the snapshot is what
    /// <see cref="IUplinkHost.AddSampler"/> exists for.
    /// </summary>
    [SitrepUplink("system")]
    public sealed class SystemUplink : ISitrepUplink, IUplinkCapabilityDeclarer
    {
        /// <summary>
        /// Declares the <c>controlFrame</c> capability, with stock's own answer as
        /// its vanilla.
        ///
        /// <para>Declared by the uplink that OWNS <c>system.frame</c> rather than
        /// alongside the vessel capabilities, which is the contract's own rule: the
        /// channel and the capability behind it move together, so a reader looking
        /// for what answers this topic finds both in one place.</para>
        ///
        /// <para>Stock's map view really is body-centred with inertial axes, so
        /// this vanilla is a true answer rather than a stand-in, and a widget
        /// following the control frame has something to follow on an install with
        /// no n-body producer at all.</para>
        /// </summary>
        public void DeclareCapabilities(Kernel kernel) =>
            ControlFrameElection.RegisterCapability(kernel, _ => new StockControlFrameSource());

        /// <summary>
        /// The frame the game's navigation view is in: what the player is looking
        /// at, and what a widget set to follow the control frame resolves against.
        /// Beside <c>system.bodies</c> and <c>system.units</c> because it is the
        /// same kind of fact, one global reference the whole view is read in.
        /// </summary>
        public const string ControlFrameTopic = "system.frame";

        /// <summary>
        /// Puts the game's navigation view in a frame, so a command centre can
        /// move it to where a plan is being discussed rather than describing where
        /// it wants the operator to look.
        /// </summary>
        public const string SetControlFrameCommand = "system.frame.set";

        public UplinkManifest Manifest { get; } = new UplinkManifest
        {
            Id = "system",
            Version = "1.0.0",
            Channels = new List<ChannelDeclaration>
            {
                new ChannelDeclaration
                {
                    Topic = SystemViewProvider.Topic,
                    Delivery = Delivery.LossyLatest,
                    // system.bodies is a static structured channel (orbital
                    // elements barely change tick to tick) - a 30s keyframe
                    // cadence plus accepting a re-emit at whatever cadence
                    // GonogoAddon samples at (currently ~1s UT) is fine per
                    // the streaming-slice-1 plan. The quantum is irrelevant
                    // here: the payload is a Dictionary, so ChannelEmitter's
                    // change-gate falls back to reference/Equals comparison,
                    // and BuildSystemBodies hands back a fresh Dictionary
                    // every call - so every considered sample reads as
                    // "changed". Unchanged from GonogoBodiesServer.BodiesEmissionPolicy.
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    // Explicit retrofit: celestial-body ephemeris is a
                    // ground-side fact (known independent of any vessel's
                    // comms link, same class as scansat.available), so this
                    // is TrueNow, bypassing the delay clock. Judgment call
                    // documented in contract-dynamic-delay-report.md: no
                    // prior mechanism existed to state this either way, and
                    // nothing observably reads it yet, so this is a
                    // classification, not a behavior change.
                    Delay = DelayRole.TrueNow,
                },
                // system.vessels -- the M3 R3 roster capture-add. Same cadence
                // as system.bodies: a re-emit every sample tick reads as
                // "changed" (fresh Dictionary/List every call), a 30s
                // keyframe floor covers a genuinely idle roster.
                new ChannelDeclaration
                {
                    Topic = SystemViewProvider.VesselsTopic,
                    Delivery = Delivery.LossyLatest,
                    // Explicit retrofit: the roster's positions/identities
                    // of OTHER vessels is comms-derived (the same class as
                    // vessel.* telemetry), so this rides the delay clock.
                    Delay = DelayRole.Delayed,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
                // target.available -- everything the active vessel could target
                // (vessels/bodies/in-range docking ports), for the TargetPicker.
                // Same cadence as system.vessels: a fresh Dictionary/List every
                // call reads as "changed" (per-entry distance moves every tick),
                // and the 30s keyframe floor covers a genuinely idle scene.
                // Delayed like system.vessels -- it carries OTHER vessels'/ports'
                // comms-derived positions/distances, not a ground-side fact.
                new ChannelDeclaration
                {
                    Topic = SystemViewProvider.TargetAvailableTopic,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.Delayed,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
                // system.frame -- what frame the game's navigation view is in.
                // TrueNow, because it is a ground-side fact about the player's own
                // screen rather than anything observed down a comms link: no delay
                // could apply to it, and delaying it would make a widget following
                // the control frame lag a change the operator made themselves.
                // A fresh Dictionary every call reads as "changed", so the 30s
                // keyframe floor covers a view nobody is touching.
                new ChannelDeclaration
                {
                    Topic = ControlFrameTopic,
                    Delivery = Delivery.LossyLatest,
                    Delay = DelayRole.TrueNow,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                },
                // ksp.revertAvailability -- whether the two stock in-flight
                // "revert" actions are available right now, for LaunchDirector's
                // revert-availability gating. A flight-scene game-state fact
                // (read from FlightDriver's static flags, the same ones KSP's
                // pause menu gates its revert buttons on), known independent of
                // any vessel's comms link, so TrueNow -- same class as
                // system.bodies. Two bools that only flip on launch/revert; a
                // fresh Dictionary every call reads as "changed" and the 30s
                // keyframe floor covers the steady state.
                new ChannelDeclaration
                {
                    Topic = SystemViewProvider.RevertTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.TrueNow,
                },
                // game.dlc -- which KSP expansions are installed. A ground-side,
                // scene-independent game fact (the Meta.Dlc path): known
                // independent of any vessel's comms link, so TrueNow -- same
                // class as system.bodies/career.status. It effectively never
                // changes mid-session (an expansion isn't installed/uninstalled
                // while KSP runs), so a fresh Dictionary every call reads as
                // "changed" and the 30s keyframe floor covers the steady state.
                new ChannelDeclaration
                {
                    Topic = SystemViewProvider.DlcTopic,
                    Delivery = Delivery.LossyLatest,
                    Emission = new EmissionPolicy(keyframeIntervalUt: 30, quantum: EmissionQuantum.Absolute(0)),
                    Delay = DelayRole.TrueNow,
                },
            },
            Commands = new List<CommandDeclaration>
            {
                // Not delayed, on the same reasoning as vessel.target.set: this
                // designates what the operator is looking at rather than actuating
                // anything on a craft, so there is no light-time for it to ride.
                // A frame change that took minutes to apply would be a fiction
                // about the operator's own screen.
                new CommandDeclaration
                {
                    Command = SetControlFrameCommand,
                    Delayed = false,
                },
            },
        };

        /// <summary>Mandatory health self-report (see <see cref="ISitrepUplink.Health"/>): a plain
        /// channel uplink is Healthy once it has registered without error.</summary>
        public UplinkHealth Health() => UplinkHealth.Healthy;

        public void Register(IUplinkHost host)
        {
            host.AddChannelSource(SystemViewProvider.Topic, SystemViewProvider.BuildSystemBodies);
            host.AddChannelSource(SystemViewProvider.VesselsTopic, SystemViewProvider.BuildSystemVessels);
            host.AddChannelSource(SystemViewProvider.TargetAvailableTopic, SystemViewProvider.BuildTargetAvailable);
            host.AddChannelSource(SystemViewProvider.RevertTopic, SystemViewProvider.BuildRevertAvailability);
            host.AddChannelSource(SystemViewProvider.DlcTopic, SystemViewProvider.BuildGameDlc);
            // Read through the election rather than off stock directly, which is
            // the whole point of the capability: an n-body producer elected over
            // stock answers this channel instead, and nothing here learns that it
            // did. The kernel is reached at call time rather than captured,
            // because Register runs before capabilities resolve.
            host.AddChannelSource(ControlFrameTopic, _ => BuildControlFrame(host.Kernel));
            // Through the same election as the read, so the source reporting the
            // view is the one that moves it.
            host.AddCommandHandler<SetControlFrameArgs, CommandResult>(
                SetControlFrameCommand,
                args => ControlFrameElection.Set(host.Kernel, args));
        }

        /// <summary>
        /// The frame the game's navigation view is in. Flattened rather than
        /// published as the contract object: a POCO on the wire throws in the
        /// writer and takes the whole uplink down with it, every channel and
        /// command at once.
        /// </summary>
        internal static Dictionary<string, object?>? BuildControlFrame(Kernel? kernel)
        {
            var frame = ControlFrameElection.Elected(kernel);
            if (frame == null)
            {
                // Nothing knows what the player is looking at. Null rather than a
                // frame with an unset kind, so a reader waiting for one is not
                // handed something that reads as an answer.
                return null;
            }

            return new Dictionary<string, object?>
            {
                ["kind"] = (int)frame.Kind,
                ["centreBody"] = frame.CentreBody,
                ["primaryBody"] = frame.PrimaryBody,
                ["secondaryBody"] = frame.SecondaryBody,
                ["primaryBodies"] = frame.PrimaryBodies,
                ["secondaryBodies"] = frame.SecondaryBodies,
                ["targetFrameSelected"] = frame.TargetFrameSelected,
                ["targetId"] = frame.TargetId,
            };
        }
    }
}
