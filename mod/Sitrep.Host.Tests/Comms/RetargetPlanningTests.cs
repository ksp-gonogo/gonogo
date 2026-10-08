using System;
using System.Collections.Generic;
using System.Linq;
using Sitrep.Contract;
using Sitrep.Contract.TestSupport;
using Sitrep.Host.Comms;
using Sitrep.Propagation;
using Sitrep.Propagation.Contacts;
using Sitrep.Propagation.Visibility;
using Xunit;

namespace Sitrep.Host.Tests.Comms
{
    /// <summary>
    /// What a craft's dishes could do if turned travels with its heard state into
    /// its centre's plan, and the conformance assertions hold a retarget backend to
    /// the contract.
    /// </summary>
    public class RetargetPlanningTests
    {
        private const double KerbinMu = 3.5316e12;
        private const double KerbinRadius = 600_000.0;
        private const int Kerbin = 1;
        private const string Relay = "vessel:r";
        private const string Dish = "vessel:r#1/0";

        private static readonly SystemBody[] Bodies =
        {
            new SystemBody(-1, null),
            new SystemBody(0, new OrbitElements(13_599_840_256.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.1723328e18)),
        };

        private static readonly PlanNode Ksc = PlanNode.OnSurface(
            "ground:ksc", Kerbin, RotatingGroundStation.FromLatitudeLongitude(0.0, 10.0, 0.0, 21_549.425, KerbinRadius, 0.0));

        private static PlanGround Ground() => new PlanGround(new[] { Ksc }, Bodies, Kerbin, index => index == Kerbin ? KerbinRadius : 0.0);

        private sealed class Turnable : IRetargetModel
        {
            public bool AutoRetargetAllowed(string nodeId) => true;

            public IReadOnlyList<DishAim> DishesOf(string nodeId) => nodeId == Relay ? new[] { new DishAim(Dish, "the Sun") } : new DishAim[0];

            public double MarginIfAimedAt(string dishId, string peerId, double ut, Vector3d dish, Vector3d peer, IContactPositions positions) => 1.0;

            public double PeerReceiveMargin(string peerId, string nodeId, double ut, Vector3d peer, Vector3d node, IContactPositions positions) => 1.0;
        }

        private static readonly AlwaysDark Dark = new AlwaysDark();

        private static CraftState Relayed(IRetargetModel? model)
        {
            var links = new Dictionary<string, CraftLink> { ["ground:ksc"] = new CraftLink(null, Dark) };
            var state = CraftState.Orbiting(
                Relay, 0.0, Kerbin, new OrbitElements(KerbinRadius + 300_000.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, KerbinMu), null, null, true, links);
            return state.WithRetarget(model);
        }

        private sealed class AlwaysDark : IContactLinkModel
        {
            public double MarginAt(double ut, Vector3d from, Vector3d to, IContactPositions positions) => -1.0;
        }

        [Fact]
        public void AHeardCraftsRetargetModelReachesItsCentresPlan()
        {
            var request = ReckonedPlan.Request(new[] { Relayed(new Turnable()) }, Ground(), 0.0, 6 * 3600.0);
            var plan = request.Run();

            Assert.NotNull(request.Retarget);
            Assert.Empty(plan.Pairs.Single().Windows);
            var turn = plan.Pairs.Single().RetargetWindows;
            Assert.NotEmpty(turn);
            Assert.All(turn, w => Assert.Equal(Dish, w.DishId));
        }

        [Fact]
        public void ACraftWithNoRetargetModelPlansNoTurns()
        {
            var request = ReckonedPlan.Request(new[] { Relayed(null) }, Ground(), 0.0, 6 * 3600.0);

            Assert.Null(request.Retarget);
            Assert.Empty(request.Run().Pairs.Single().RetargetWindows);
        }

        [Fact]
        public void ARequestWithTheSameModelsMatchesAndOneWithAnotherDoesNot()
        {
            var state = Relayed(new Turnable());
            var a = ReckonedPlan.Request(new[] { state }, Ground(), 0.0, 3600.0);
            var b = ReckonedPlan.Request(new[] { state }, Ground(), 10.0, 3600.0);
            var c = ReckonedPlan.Request(new[] { state.WithRetarget(new Turnable()) }, Ground(), 10.0, 3600.0);

            Assert.True(a.Matches(b));
            Assert.False(a.Matches(c));
        }

        private sealed class Positions : IContactPositions
        {
            public Vector3d? NodeAt(string nodeId, double ut) => nodeId == "node" ? new Vector3d(7e5, 0, 0) : new Vector3d(0, 7e5, 0);

            public Vector3d BodyAt(int bodyIndex, double ut) => new Vector3d(0, 0, 0);
        }

        private sealed class Backend : ICommsRetargetBackend
        {
            private readonly IRetargetModel _model = new Turnable();

            public IRetargetModel? RetargetModel(object? node, double ut) => node is string ? _model : null;

            public bool AutoRetargetAllowed(string nodeId) => true;

            public bool PeerCanReceive(string peerId, string nodeId, double ut) => true;

            public string? TurnDish(string nodeId, string dishId, string peerId, double ut) => dishId == Dish ? "record" : null;

            public bool RestoreDish(string recordId, double ut) => true;
        }

        [Fact]
        public void ABackendThatKeepsTheContractPassesTheConformanceAssertion()
        {
            RetargetConformance.AssertRetargetBackendContract(new Backend(), Relay, Relay, "ground:ksc", new Positions(), 0.0, 1000.0);
        }

        private sealed class ImpureModel : IRetargetModel
        {
            private int _calls;

            public bool AutoRetargetAllowed(string nodeId) => true;

            public IReadOnlyList<DishAim> DishesOf(string nodeId) => nodeId == Relay ? new[] { new DishAim(Dish, "x") } : new DishAim[0];

            public double MarginIfAimedAt(string dishId, string peerId, double ut, Vector3d dish, Vector3d peer, IContactPositions positions) => ++_calls;

            public double PeerReceiveMargin(string peerId, string nodeId, double ut, Vector3d peer, Vector3d node, IContactPositions positions) => 1.0;
        }

        [Fact]
        public void AModelThatCarriesStateBetweenCallsFailsTheConformanceAssertion()
        {
            Assert.ThrowsAny<Exception>(() =>
                RetargetConformance.AssertRetargetModelContract(new ImpureModel(), Relay, "ground:ksc", new Positions(), 0.0, 1000.0));
        }
    }
}
