using System;
using Xunit;

namespace Sitrep.Contract.TestSupport
{
    /// <summary>
    /// What <see cref="ICommsRetargetBackend"/> and the <see cref="IRetargetModel"/>
    /// it hands back promise, for an implementer to run against their own backend.
    /// </summary>
    public static class RetargetConformance
    {
        /// <summary>
        /// Asserts the contract for one node and one peer: a node the backend does
        /// not know gets no model rather than a throw, a dish that does not exist is
        /// refused a turn without a throw, a restore of a record nobody made is
        /// settled without a throw, and a model that is returned keeps the model's
        /// own contract over <paramref name="fromUt"/> to <paramref name="toUt"/>.
        /// </summary>
        /// <param name="backend">The backend under test.</param>
        /// <param name="node">The node, as the backend's own node object.</param>
        /// <param name="nodeId">The same node's id.</param>
        /// <param name="peerId">The id of a peer to ask about.</param>
        /// <param name="positions">Where every node and body is, with the two ends as <c>"node"</c> and <c>"peer"</c>.</param>
        /// <param name="fromUt">The start of the span.</param>
        /// <param name="toUt">The end of the span; must be after <paramref name="fromUt"/>.</param>
        public static void AssertRetargetBackendContract(
            ICommsRetargetBackend backend, object? node, string nodeId, string peerId, IContactPositions positions, double fromUt, double toUt)
        {
            Assert.NotNull(backend);
            var name = backend.GetType().Name;

            IRetargetModel? unknown = null;
            Exception? ex = null;
            try
            {
                unknown = backend.RetargetModel(new object(), fromUt);
            }
            catch (Exception thrown)
            {
                ex = thrown;
            }
            Assert.True(
                ex == null && unknown == null,
                name + ".RetargetModel must return null for a node it does not recognise, not "
                + (ex == null ? "a model" : "throw " + ex.GetType().Name) + ".");

            string? record = "unset";
            ex = null;
            try
            {
                record = backend.TurnDish(nodeId, "no-such-node#0/0", peerId, fromUt);
            }
            catch (Exception thrown)
            {
                ex = thrown;
            }
            Assert.True(
                ex == null && record == null,
                name + ".TurnDish must refuse a dish that does not exist with null, not "
                + (ex == null ? "a record" : "throw " + ex.GetType().Name) + ".");

            ex = null;
            try
            {
                backend.RestoreDish("no-such-record", fromUt);
            }
            catch (Exception thrown)
            {
                ex = thrown;
            }
            Assert.True(ex == null, name + ".RestoreDish must settle a record nobody made, not throw " + ex?.GetType().Name + ".");

            var model = backend.RetargetModel(node, fromUt);
            if (model != null)
            {
                AssertRetargetModelContract(model, nodeId, peerId, positions, fromUt, toUt);
            }
        }

        /// <summary>
        /// Asserts a retarget model is a pure, finite function of time: its margins
        /// are finite over the span and asked again, backwards, give the same
        /// answer; it names the same dishes each time; and a node it does not know
        /// has none.
        /// </summary>
        /// <param name="model">The model under test.</param>
        /// <param name="nodeId">The node it answers for.</param>
        /// <param name="peerId">A peer to ask about.</param>
        /// <param name="positions">Where every node and body is, with the two ends as <c>"node"</c> and <c>"peer"</c>.</param>
        /// <param name="fromUt">The start of the span.</param>
        /// <param name="toUt">The end of the span; must be after <paramref name="fromUt"/>.</param>
        public static void AssertRetargetModelContract(
            IRetargetModel model, string nodeId, string peerId, IContactPositions positions, double fromUt, double toUt)
        {
            Assert.NotNull(model);
            Assert.NotNull(positions);
            Assert.True(toUt > fromUt, "the span to evaluate over must end after it starts");
            var name = model.GetType().Name;

            Assert.Empty(model.DishesOf("no-such-node"));

            var dishes = model.DishesOf(nodeId);
            const int samples = 32;
            foreach (var dish in dishes)
            {
                Assert.False(string.IsNullOrEmpty(dish.DishId), name + ".DishesOf named a dish with no id.");
                Assert.StartsWith(nodeId + "#", dish.DishId, StringComparison.Ordinal);

                var first = new double[samples + 1];
                for (var i = 0; i <= samples; i++)
                {
                    var ut = fromUt + ((toUt - fromUt) * i / samples);
                    first[i] = model.MarginIfAimedAt(dish.DishId, peerId, ut, At(positions, "node", ut), At(positions, "peer", ut), positions);
                    Assert.False(
                        double.IsNaN(first[i]) || double.IsInfinity(first[i]),
                        name + ".MarginIfAimedAt(" + ut + ") is " + first[i] + ". A margin is finite: its sign is the answer and the planner bisects on it.");
                }
                for (var i = samples; i >= 0; i--)
                {
                    var ut = fromUt + ((toUt - fromUt) * i / samples);
                    var again = model.MarginIfAimedAt(dish.DishId, peerId, ut, At(positions, "node", ut), At(positions, "peer", ut), positions);
                    Assert.True(
                        again.Equals(first[i]),
                        name + ".MarginIfAimedAt(" + ut + ") gave " + first[i] + " and then " + again + ". A retarget model is pure: it is asked in any order.");
                }
            }

            for (var i = 0; i <= samples; i++)
            {
                var ut = fromUt + ((toUt - fromUt) * i / samples);
                var margin = model.PeerReceiveMargin(peerId, nodeId, ut, At(positions, "peer", ut), At(positions, "node", ut), positions);
                Assert.False(
                    double.IsNaN(margin) || double.IsInfinity(margin),
                    name + ".PeerReceiveMargin(" + ut + ") is " + margin + ". A margin is finite.");
            }

            Assert.Equal(dishes.Count, model.DishesOf(nodeId).Count);
        }

        private static Vector3d At(IContactPositions positions, string id, double ut) =>
            positions.NodeAt(id, ut) ?? new Vector3d(0, 0, 0);
    }
}
