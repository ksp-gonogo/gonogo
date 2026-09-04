using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// What gonogo reports when the save models NO COMMS NETWORK AT ALL: the
    /// stock CommNet difficulty option (<c>GameParameters.DifficultyParams.EnableCommNet</c>,
    /// which is what <c>CommNetScenario.CommNetEnabled</c> reads) is off.
    ///
    /// <para><b>Why this exists.</b> With that option off KSP destroys
    /// <c>CommNetScenario</c> in its own <c>OnAwake</c>, so no network is ever
    /// built, no vessel's <c>CommNetVessel.IsConnected</c> is ever set, and
    /// every <c>ControlPath</c> stays empty for the whole session. Read
    /// literally, that is a craft with no link home, and gonogo's reveal gate
    /// froze every Delayed channel on it forever: a permanent blackout on a
    /// save whose entire point is that there is nothing to black out. KSP
    /// itself does not read it that way. <c>Vessel.GetControlLevel</c> takes
    /// the CommNet branch only when <c>CommNetScenario.Instance != null &amp;&amp;
    /// CommNetScenario.CommNetEnabled</c>, and otherwise falls back to the
    /// craft's own <c>Part.isControlSource</c> walk: control reaches the vessel
    /// directly, from anywhere, with no link involved.</para>
    ///
    /// <para><b>Absent, zero and held stay three different things.</b> "There
    /// is no comms model, so there is no delay" is a POSITIVE FACT: it is a
    /// measured-and-known zero (<see cref="CommsDelaySource.NoCommsModel"/>,
    /// <c>oneWaySeconds = 0</c>), never a null and never a last-known value
    /// held through an outage. Signal strength goes the other way: it is not
    /// modelled here, so it is ABSENT (null), not zero.</para>
    ///
    /// <para><b>Kept free of KSP</b>, the same discipline as
    /// <see cref="SimulationDelayPolicy"/>: the one live read (is the option
    /// on) happens in <c>Gonogo.KSP</c> and arrives here as a
    /// <see cref="bool"/>?, so every rule below is exercised headlessly.</para>
    /// </summary>
    public static class CommsModelPolicy
    {
        /// <summary>
        /// The config every delay reader should use this tick, given the
        /// authored (or already simulation-derived) one and whether this save
        /// models comms at all.
        ///
        /// <para><paramref name="modelPresent"/> is three-state on purpose.
        /// <c>true</c> and <c>null</c> both return the config UNCHANGED: null
        /// is "nothing has said yet" (no save loaded, or the read threw), and
        /// treating an unknown as "no comms model" would silently switch a
        /// real career's delay off. Only a definite <c>false</c> cuts.</para>
        ///
        /// <para>Cuts even when the delay flag is already off, because the
        /// derived config carries the REASON: without it a save with no comms
        /// model is indistinguishable on the wire from one whose operator
        /// simply never turned delay on.</para>
        /// </summary>
        public static SignalDelayConfig Effective(SignalDelayConfig? authored, bool? modelPresent)
        {
            var config = authored ?? SignalDelayConfig.Off();

            if (modelPresent != false)
            {
                return config;
            }

            return new SignalDelayConfig
            {
                Enabled = false,
                LightSpeedScale = config.LightSpeedScale,
                SilenceDeclarationSeconds = config.SilenceDeclarationSeconds,
                DelayInSimulation = config.DelayInSimulation,
                CutForNoCommsModel = true,
            };
        }

        /// <summary>
        /// The elected backend as every comms reader should see it this tick.
        /// Returns <paramref name="elected"/> untouched unless
        /// <paramref name="modelPresent"/> is a definite <c>false</c>, in which
        /// case it comes back wrapped in <see cref="NoCommsModelBackend"/>.
        ///
        /// <para>A WRAPPER rather than a check at each reader, because the
        /// readers must never disagree: the reveal gate's connectivity source
        /// and the <c>comms.connectivity</c> channel are separate calls into
        /// the same backend, and a board whose channel says connected while
        /// its gate stays frozen is the exact live-KSP symptom this whole area
        /// keeps producing. It also covers whichever backend won the election,
        /// which matters because the difficulty option kills RealAntennas'
        /// network as surely as it kills stock's.</para>
        /// </summary>
        /// <param name="localControl">
        /// The craft's own control tier, from its parts rather than from any
        /// link: stock's own fallback when the CommNet branch is not taken. See
        /// <see cref="NoCommsModelBackend"/>.
        /// </param>
        /// <param name="meta">
        /// Which subject each reading is about and how current it is. Supplied
        /// by the same live-vessel read as <paramref name="localControl"/>
        /// rather than taken off the wrapped backend, so wrapping costs one
        /// vessel read per tick instead of one per readout.
        /// </param>
        public static ICommsBackend? Effective(
            ICommsBackend? elected,
            bool? modelPresent,
            Func<CommsControlSource> localControl,
            Func<PayloadMeta> meta)
        {
            if (elected == null || modelPresent != false)
            {
                return elected;
            }
            return new NoCommsModelBackend(elected, localControl, meta);
        }
    }

    /// <summary>
    /// The elected <see cref="ICommsBackend"/> as read on a save that models no
    /// comms network (see <see cref="CommsModelPolicy"/> for why). Everything
    /// that describes a LINK is answered from the absence of a link model
    /// rather than from the dead CommNet graph underneath; everything that
    /// describes the universe rather than the link (the occlusion geometry) is
    /// passed straight through.
    /// </summary>
    public sealed class NoCommsModelBackend : ICommsBackend
    {
        private readonly ICommsBackend _inner;
        private readonly Func<CommsControlSource> _localControl;
        private readonly Func<PayloadMeta> _meta;

        public NoCommsModelBackend(
            ICommsBackend inner,
            Func<CommsControlSource> localControl,
            Func<PayloadMeta> meta)
        {
            _inner = inner ?? throw new ArgumentNullException(nameof(inner));
            _localControl = localControl ?? throw new ArgumentNullException(nameof(localControl));
            _meta = meta ?? throw new ArgumentNullException(nameof(meta));
        }

        /// <summary>
        /// The wrapped backend's own id. The election outcome has not changed,
        /// only what that backend is in a position to claim; a client asking
        /// which model is in force reads <c>comms.delay.source</c>, which says
        /// <see cref="CommsDelaySource.NoCommsModel"/> outright.
        /// </summary>
        public string ProviderId => _inner.ProviderId;

        /// <summary>
        /// CONNECTED, always: nothing can interrupt a link that is not
        /// modelled. The control tier comes from the craft's own parts, which
        /// is where KSP itself gets it once the CommNet branch is not taken, so
        /// a probe with no command module still reports no control and a manned
        /// pod still reports full.
        /// </summary>
        public CommsConnectivity Connectivity()
        {
            var control = LocalControl();
            return new CommsConnectivity
            {
                Connected = true,
                ControlSource = control,
                // Every control source is local when no link mediates it.
                HasLocalControl = control != CommsControlSource.None,
                Meta = Meta(),
            };
        }

        /// <summary>
        /// FULL. Nothing attenuates a link that is not modelled.
        ///
        /// <para>The honest answer is that there is no link budget to grade, so
        /// the value is ABSENT, and <see cref="CommsSignalStrength.Value"/>
        /// cannot say that: it is not nullable, and making it nullable is a
        /// retype the contract shape gate refuses without a Major bump. Of the
        /// two things it CAN say, 1 is the one that does not lie: 0 is what the
        /// app's own loss verdict keys on, so reporting it would announce total
        /// signal loss on a board where every channel is arriving. A reader
        /// that needs to know this is not a grading has
        /// <see cref="CommsDelaySource.NoCommsModel"/> on <c>comms.delay</c>.</para>
        /// </summary>
        public CommsSignalStrength SignalStrength() => new CommsSignalStrength
        {
            Value = 1.0,
            Meta = Meta(),
        };

        /// <summary>
        /// The same control tier <see cref="Connectivity"/> reports.
        ///
        /// <para><see cref="CommsControlState.Reason"/> never says "no
        /// connection to a command source" here, which would name a condition
        /// that does not exist: there is no connection MODEL, not a missing
        /// connection. An uncontrollable craft is uncontrollable for the one
        /// reason left, which is that nothing aboard it can be a command
        /// source.</para>
        /// </summary>
        public CommsControlState ControlState()
        {
            var control = LocalControl();
            return new CommsControlState
            {
                State = control switch
                {
                    CommsControlSource.Full => CommsControlStateKind.Full,
                    CommsControlSource.Partial => CommsControlStateKind.PartialManoeuvre,
                    _ => CommsControlStateKind.None,
                },
                Reason = control == CommsControlSource.None ? "no command source aboard" : null,
                Meta = Meta(),
            };
        }

        /// <summary>
        /// EMPTY, and that is the honest answer rather than a degraded one:
        /// a path is a route through a relay graph, and there is no graph. The
        /// zero delay a reader wants from this comes from the config cut
        /// (<see cref="CommsModelPolicy.Effective(SignalDelayConfig, bool?)"/>),
        /// which reports it as a known zero; an empty path on its own would
        /// report it as an unmeasurable absence, which is the opposite claim.
        /// </summary>
        public CommsPath Path() => new CommsPath
        {
            Hops = new List<CommsHop>(),
            Meta = Meta(),
        };

        /// <summary>Empty, for the same reason <see cref="Path"/> is.</summary>
        public CommsNetwork Network() => new CommsNetwork
        {
            Nodes = new List<CommsNetworkNode>(),
            Edges = new List<CommsNetworkEdge>(),
            Meta = Meta(),
        };

        /// <summary>
        /// Passed through. Occlusion is a statement about the bodies, not about
        /// the link, and a consumer drawing a horizon still wants the real one.
        /// </summary>
        public ICommsOcclusionModel OcclusionModel() => _inner.OcclusionModel();

        /// <summary>
        /// The craft's own control tier, fail-soft to
        /// <see cref="CommsControlSource.None"/>: the probe reads live KSP, and
        /// a throw on a scene-settle tick must not be allowed to escape onto
        /// the capture path.
        /// </summary>
        private CommsControlSource LocalControl()
        {
            try
            {
                return _localControl();
            }
            catch (Exception)
            {
                return CommsControlSource.None;
            }
        }

        /// <summary>
        /// Which subject the reading is about and how current it is, fail-soft
        /// to an empty meta for the same reason <see cref="LocalControl"/> is:
        /// this reads live KSP on the capture path.
        /// </summary>
        private PayloadMeta Meta()
        {
            try
            {
                return _meta() ?? new PayloadMeta();
            }
            catch (Exception)
            {
                return new PayloadMeta();
            }
        }
    }
}
