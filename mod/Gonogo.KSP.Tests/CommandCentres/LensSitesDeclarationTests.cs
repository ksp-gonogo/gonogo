using System.Collections.Generic;
using CommNet;
using Gonogo.KSP.CommandCentres;
using Sitrep.Contract;
using Sitrep.Host;
using Sitrep.Host.CommandCentres;
using UnityEngine;
using Xunit;

namespace Gonogo.KSP.Tests.CommandCentres
{
    /// <summary>
    /// The <c>lensSites</c> capability the centre delay Uplink declares finds a
    /// ground station by the name of its network node, over the same registry the
    /// roster reads, and never a craft.
    /// </summary>
    public class LensSitesDeclarationTests
    {
        [Fact]
        public void AStationIsFoundByItsNodeNameAndACraftIsNot()
        {
            var registry = new CommandCentreRegistry();
            registry.RegisterSource(new StaticSource(new ICommandCentre[]
            {
                Station("ground:Twin#2", "Twin"),
                Station("ground:Kerbin: KSC", "Kerbin: KSC"),
                new KspCommandCentre("vessel:abc", "abc", CommandCentreKind.CrewedVessel, 1, new CommNode(), new Vector3d(0.0, 0.0, 0.0), active: true),
            }));
            var engine = new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0);
            var kernel = new Kernel();
            new CommandCentreDelayUplink(registry, lensEngine: engine).DeclareCapabilities(kernel);
            kernel.Resolve(new ResolveOptions { KernelVersion = "1.0.0" });

            var sites = kernel.Query<ILensSites>(LensSitesCapability.Id);

            Assert.Equal("ground:Twin#2", sites.GroundStationNamed("Twin"));
            Assert.Equal("ground:Kerbin: KSC", sites.GroundStationNamed("Kerbin: KSC"));
            Assert.Null(sites.GroundStationNamed("abc"));
            Assert.Null(sites.GroundStationNamed("Twin#2"));
        }

        [Fact]
        public void ASurfacePointBelongsToTheNearestStationOnItsBody()
        {
            var sites = SitesOver(
                Station("ground:Kerbin: KSC", "Kerbin: KSC", 1, -0.1, -74.6),
                Station("ground:Woomerang", "Woomerang", 1, 45.3, -0.1),
                Station("ground:Mun Base", "Mun Base", 2, -0.1, -74.6));

            Assert.Equal("ground:Kerbin: KSC", sites.GroundStationNear(1, -0.09, -74.55));
            Assert.Equal("ground:Woomerang", sites.GroundStationNear(1, 45.0, 0.0));
            Assert.Equal("ground:Mun Base", sites.GroundStationNear(2, 45.0, 0.0));
        }

        [Fact]
        public void NoStationOnTheBodyIsNoAnswer()
        {
            var sites = SitesOver(Station("ground:Kerbin: KSC", "Kerbin: KSC", 1, -0.1, -74.6));

            Assert.Null(sites.GroundStationNear(2, -0.1, -74.6));
        }

        [Fact]
        public void TwoStationsEquallyNearIsNoAnswer()
        {
            var sites = SitesOver(
                Station("ground:West", "West", 1, 0.0, -10.0),
                Station("ground:East", "East", 1, 0.0, 10.0));

            Assert.Null(sites.GroundStationNear(1, 0.0, 0.0));
            Assert.Equal("ground:East", sites.GroundStationNear(1, 0.0, 1.0));
        }

        private static ILensSites SitesOver(params KspCommandCentre[] centres)
        {
            var registry = new CommandCentreRegistry();
            registry.RegisterSource(new StaticSource(centres));
            var kernel = new Kernel();
            new CommandCentreDelayUplink(registry, lensEngine: new ChannelEngine("ws://127.0.0.1:0", networkDelaySeconds: 0)).DeclareCapabilities(kernel);
            kernel.Resolve(new ResolveOptions { KernelVersion = "1.0.0" });
            return kernel.Query<ILensSites>(LensSitesCapability.Id);
        }

        private static KspCommandCentre Station(string id, string nodeName, int bodyIndex, double latitude, double longitude) =>
            new KspCommandCentre(
                id,
                nodeName,
                CommandCentreKind.GroundStation,
                bodyIndex,
                node: new CommNode(),
                position: new Vector3d(0.0, 0.0, 0.0),
                active: true,
                latitude: latitude,
                longitude: longitude,
                nodeName: nodeName);

        [Fact]
        public void WithoutAnEngineNoCapabilityIsDeclared()
        {
            var kernel = new Kernel();
            new CommandCentreDelayUplink(new CommandCentreRegistry()).DeclareCapabilities(kernel);
            kernel.Resolve(new ResolveOptions { KernelVersion = "1.0.0" });

            Assert.ThrowsAny<System.Exception>(() => kernel.Query<ILensSites>(LensSitesCapability.Id));
        }

        private static KspCommandCentre Station(string id, string nodeName) =>
            new KspCommandCentre(
                id,
                nodeName,
                CommandCentreKind.GroundStation,
                bodyIndex: 1,
                node: new CommNode(),
                position: new Vector3d(0.0, 0.0, 0.0),
                active: true,
                latitude: 0.0,
                longitude: 0.0,
                nodeName: nodeName);

        private sealed class StaticSource : ICommandCentreSource
        {
            private readonly IReadOnlyList<ICommandCentre> _centres;

            public StaticSource(IReadOnlyList<ICommandCentre> centres) => _centres = centres;

            public string ProviderId => "static-test";

            public IEnumerable<ICommandCentre> Enumerate() => _centres;
        }
    }
}
