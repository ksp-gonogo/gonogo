using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// Several craft's retarget models as one: every question goes to the model of
    /// the node it is about. The dishes a plan can turn are the ones each craft's
    /// own model captured when its state was last heard, so a centre plans a turn
    /// from nothing newer than it has heard.
    /// </summary>
    public sealed class CompositeRetargetModel : IRetargetModel
    {
        private readonly IReadOnlyDictionary<string, IRetargetModel> _byNode;
        private readonly Dictionary<string, IRetargetModel> _byDish = new Dictionary<string, IRetargetModel>(StringComparer.Ordinal);

        public CompositeRetargetModel(IReadOnlyDictionary<string, IRetargetModel> byNode)
        {
            _byNode = byNode;
            foreach (var entry in byNode)
            {
                foreach (var dish in entry.Value.DishesOf(entry.Key))
                {
                    _byDish[dish.DishId] = entry.Value;
                }
            }
        }

        /// <summary>The nodes this model answers for, for comparing one plan's inputs with another's.</summary>
        public IReadOnlyDictionary<string, IRetargetModel> Models => _byNode;

        public bool AutoRetargetAllowed(string nodeId) =>
            _byNode.TryGetValue(nodeId, out var model) && model.AutoRetargetAllowed(nodeId);

        public IReadOnlyList<DishAim> DishesOf(string nodeId) =>
            _byNode.TryGetValue(nodeId, out var model) ? model.DishesOf(nodeId) : new DishAim[0];

        public double MarginIfAimedAt(string dishId, string peerId, double ut, Vector3d dish, Vector3d peer, IContactPositions positions) =>
            _byDish.TryGetValue(dishId, out var model) ? model.MarginIfAimedAt(dishId, peerId, ut, dish, peer, positions) : -1.0;

        /// <summary>
        /// A peer with no model of its own is a ground station or a craft with
        /// nothing to say, which receives from anyone in sight: the pair's own
        /// line of sight and reach already bound the answer.
        /// </summary>
        public double PeerReceiveMargin(string peerId, string nodeId, double ut, Vector3d peer, Vector3d node, IContactPositions positions) =>
            _byNode.TryGetValue(peerId, out var model) ? model.PeerReceiveMargin(peerId, nodeId, ut, peer, node, positions) : 1.0;
    }
}
