using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Sitrep.Host.Comms;
using Xunit;
using Xunit.Sdk;

namespace Sitrep.Host.Tests
{
    public class CommsContactModelSeamTests
    {
        private sealed class Node
        {
        }

        private static readonly Node From = new Node();
        private static readonly Node To = new Node();

        /// <summary>Every node sits still on one axis, so a link model's answer depends only on what it is asked.</summary>
        private sealed class StillPositions : IContactPositions
        {
            public Vector3d? NodeAt(string nodeId, double ut) => new Vector3d(nodeId.Length, 0, 0);

            public Vector3d BodyAt(int bodyIndex, double ut) => new Vector3d(0, 0, 0);
        }

        private sealed class OpensAt : IContactLinkModel
        {
            private readonly double _ut;

            public OpensAt(double ut) => _ut = ut;

            public double MarginAt(double ut, Vector3d from, Vector3d to, IContactPositions positions) => ut - _ut;
        }

        /// <summary>Answers from what it was asked last, which is the state a link model must not carry.</summary>
        private sealed class Remembering : IContactLinkModel
        {
            private double _last;

            public double MarginAt(double ut, Vector3d from, Vector3d to, IContactPositions positions)
            {
                var margin = ut - _last;
                _last = ut;
                return margin;
            }
        }

        private class Backend : ICommsBackend
        {
            public Backend(string id) => ProviderId = id;

            public string ProviderId { get; }
            public bool? StillCarriesTo(object? vessel, string nodeId) => null;
            public CommsConnectivity Connectivity() => new CommsConnectivity();
            public CommsSignal Signal() => new CommsSignal();
            public CommsControl ControlState() => new CommsControl();
            public CommsPath Path(object? vessel) => new CommsPath();
            public CommsNetwork Network(object? vessel) => new CommsNetwork();
            public IReadOnlyList<CommsRouteHop>? RouteBetween(object? from, object? to) => null;
            public ICommsReachModel ReachModel(object? from, object? to) => CommsReachModels.Unknown;
            public object? ControlPathTerminus(object? vessel) => null;
            public ICommsOcclusionModel OcclusionModel() => CommsOcclusionModels.Unknown;
            public ICommsDegradeModel DegradeModel() => CommsDegradeModels.Unknown;
        }

        private sealed class SteeredBackend : Backend, ICommsContactModel
        {
            private readonly Func<IContactLinkModel> _link;

            public SteeredBackend(Func<IContactLinkModel> link)
                : base("test-steered") => _link = link;

            public IContactLinkModel? LinkModel(object? from, object? to, double ut) =>
                ReferenceEquals(from, From) && ReferenceEquals(to, To) ? _link() : null;
        }

        private static Kernel Electing(ICommsBackend backend)
        {
            var kernel = new Kernel();
            CommsElection.RegisterCapability(kernel, _ => new Backend("commnet"));
            kernel.RegisterProvider(new ProviderRegistration
            {
                Capability = CommsElection.CapabilityId,
                Id = backend.ProviderId,
                Priority = 100.0,
                Factory = _ => backend,
            });
            kernel.Resolve(new ResolveOptions { KernelVersion = "2.2.0" });
            return kernel;
        }

        [Fact]
        public void ABackendWithoutAContactModelLeavesEveryPairToGeometry()
        {
            Assert.Null(CommsElection.LinkModel(Electing(new Backend("test-plain")), From, To, 0.0));
            Assert.Null(CommsElection.LinkModel(null, From, To, 0.0));
        }

        [Fact]
        public void AnElectedContactModelIsReachedThroughTheElectionAndConforms()
        {
            var backend = new SteeredBackend(() => new OpensAt(500.0));
            var link = CommsElection.LinkModel(Electing(backend), From, To, 0.0);

            Assert.NotNull(link);
            Assert.True(link!.MarginAt(600.0, new Vector3d(0, 0, 0), new Vector3d(1, 0, 0), new StillPositions()) > 0.0);
            ContactModelConformance.AssertContactModelContract(backend, From, To, 0.0, new StillPositions(), 3600.0);
        }

        [Fact]
        public void TheConformanceAssertionRefusesALinkModelThatRemembersItsLastCall()
        {
            Assert.ThrowsAny<XunitException>(() =>
                ContactModelConformance.AssertLinkModelContract(new Remembering(), new StillPositions(), 0.0, 3600.0));
        }
    }
}
