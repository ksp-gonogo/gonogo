using System;
using System.Collections.Generic;
using CommNet;
using Gonogo.KSP.CommandCentres;
using Sitrep.Contract;
using Sitrep.Host.CommandCentres;
using Sitrep.Host.Comms;
using UnityEngine;
using Xunit;

namespace Gonogo.KSP.Tests.Comms
{
    /// <summary>
    /// WHO gets asked which command centre the vessel is talking to.
    ///
    /// <para>Naming the centre is a universal question: the terminal node of an
    /// already-solved control path, matched against the live centre registry.
    /// Both backends inherit stock's <c>isHome</c> and <c>isControlSource</c>
    /// unchanged and both already walk the same <c>ControlPath</c>, so the rule
    /// works verbatim under either. It was nonetheless gated to ONE of them by
    /// living on the concrete class rather than the interface, behind a
    /// <c>backend is CommNetBackend</c> downcast in the core comms
    /// registration.</para>
    ///
    /// <para>The consequence was not a wrong name, it was silence:
    /// <c>comms.commandCentre</c> came back all-null forever on a RealAntennas
    /// install, which the contract documents as "no live remote centre right
    /// now" and is therefore indistinguishable from having no connection. Dark
    /// exactly where RSS/RA's dozen ground stations make "which one am I talking
    /// to" a real question instead of a trivial one.</para>
    ///
    /// <para>The mirror image of the <c>ReadNodePath</c> trap: that one had core
    /// answering a backend question itself, this one had core refusing to ask
    /// the question of anyone but stock.</para>
    /// </summary>
    public class CommandCentreOffTheSeamTests
    {
        private const string KourouId = "ground:Kourou";

        /// <summary>
        /// A two-node graph whose control path terminates at a home node, which
        /// is the ordinary case: a craft in direct contact with a ground
        /// station.
        /// </summary>
        private static (CommNode vessel, CommNode home) DirectToHome()
        {
            var net = new CommNetwork();
            var home = new CommNode { name = "Kourou", displayName = "Kourou", isHome = true };
            var vessel = new CommNode { name = "probe", displayName = "Probe" };
            net.Add(home);
            net.Add(vessel);
            return (vessel, home);
        }

        private static CommandCentreRegistry RegistryNaming(CommNode node)
        {
            var registry = new CommandCentreRegistry();
            registry.RegisterSource(new OneCentre(new KspCommandCentre(
                KourouId,
                "Kourou",
                CommandCentreKind.GroundStation,
                bodyIndex: 1,
                node: node,
                position: new Vector3d(0, 0, 0),
                active: true)));
            return registry;
        }

        private sealed class OneCentre : ICommandCentreSource
        {
            private readonly ICommandCentre _centre;
            public OneCentre(ICommandCentre centre) => _centre = centre;
            public string ProviderId => "test-centres";
            public IEnumerable<ICommandCentre> Enumerate() => new[] { _centre };
        }

        /// <summary>
        /// A backend that is not <c>CommNetBackend</c> and whose path plainly
        /// terminates at a home node. It answers the seam's terminus question
        /// with the node stock's own rule would pick, which is the point: there
        /// is nothing here core could not resolve.
        /// </summary>
        private sealed class ForeignBackend : ICommsBackend
        {
            private readonly CommNode _terminus;

            public ForeignBackend(CommNode terminus) => _terminus = terminus;

            public string ProviderId => "test-foreign";

            public object? ControlPathTerminus() => _terminus;

            public CommsConnectivity Connectivity() => new CommsConnectivity { Connected = true };
            public CommsSignalStrength SignalStrength() => new CommsSignalStrength();
            public CommsControlState ControlState() => new CommsControlState();
            public CommsPath Path() => new CommsPath();
            public CommsNetwork Network() => new CommsNetwork();
            public IReadOnlyList<CommsRouteHop>? RouteBetween(object? from, object? to) => null;
            public ICommsReachModel ReachModel(object? from, object? to) => CommsReachModels.Unknown;
            public ICommsOcclusionModel OcclusionModel() => CommsOcclusionModels.Unknown;

            public ICommsDegradeModel DegradeModel() => CommsDegradeModels.Unknown;
        }

        /// <summary>
        /// The replication, and the fix. A backend that is not stock's, whose
        /// path terminates at a registered ground station, must name that
        /// station. Under the downcast it named nothing at all, and nothing on
        /// the wire distinguished that from a blackout.
        /// </summary>
        [Fact]
        public void ANonStockBackendsTerminusStillNamesItsCentre()
        {
            var (_, home) = DirectToHome();
            var backend = new ForeignBackend(home);

            var centre = CommandCentreResolution.Resolve(
                backend.ControlPathTerminus(), RegistryNaming(home), new PayloadMeta());

            Assert.Equal(KourouId, centre.Id);
            Assert.Equal("Kourou", centre.DisplayName);
            Assert.Equal(CommandCentreKind.GroundStation.ToString(), centre.Kind);
            Assert.Equal(1, centre.BodyIndex);
        }

        /// <summary>
        /// And the honest absence it must stay distinguishable from: a backend
        /// whose path terminates nowhere names nothing. Same all-null payload,
        /// but now it means what the contract says it means rather than "core
        /// declined to ask".
        /// </summary>
        [Fact]
        public void ATerminusOfNowhereStillNamesNothing()
        {
            var (_, home) = DirectToHome();

            var centre = CommandCentreResolution.Resolve(
                null, RegistryNaming(home), new PayloadMeta());

            Assert.Null(centre.Id);
            Assert.Null(centre.DisplayName);
            Assert.Null(centre.Kind);
            Assert.Null(centre.BodyIndex);
        }

        /// <summary>
        /// A terminus that matches no registered centre is also nothing: the
        /// match is by REFERENCE against the same live centres
        /// <c>commandCentre.roster</c> enumerates, so the two can never name the
        /// terminus differently.
        /// </summary>
        [Fact]
        public void ATerminusMatchingNoRegisteredCentreNamesNothing()
        {
            var (vessel, home) = DirectToHome();

            var centre = CommandCentreResolution.Resolve(
                vessel, RegistryNaming(home), new PayloadMeta());

            Assert.Null(centre.Id);
        }

        /// <summary>
        /// The meta rides through untouched, because a payload that named no
        /// centre still has to say which vessel and what quality it was read
        /// at.
        /// </summary>
        [Fact]
        public void TheCaptureMetaSurvivesAMissingCentre()
        {
            var meta = new PayloadMeta { Source = "vessel:abc", Quality = Quality.OnRails };

            var centre = CommandCentreResolution.Resolve(null, null, meta);

            Assert.Same(meta, centre.Meta);
        }
    }
}
