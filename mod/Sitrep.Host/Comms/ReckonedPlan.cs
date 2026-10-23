using System;
using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Propagation;
using Sitrep.Propagation.Contacts;
using Sitrep.Propagation.Visibility;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// What needs no reception to know: the ground stations, which are fixed on
    /// their bodies, and the bodies themselves, whose positions are the same
    /// function of time for everyone.
    /// </summary>
    public sealed class PlanGround
    {
        public PlanGround(
            IReadOnlyList<PlanNode> stations,
            IReadOnlyList<SystemBody> bodies,
            int frameBodyIndex,
            Func<int, double> occludingRadius)
        {
            Stations = stations;
            Bodies = bodies;
            FrameBodyIndex = frameBodyIndex;
            OccludingRadius = occludingRadius;
        }

        /// <summary>Every ground station, each a node fixed to its body's surface.</summary>
        public IReadOnlyList<PlanNode> Stations { get; }

        /// <summary>The body table positions are solved over.</summary>
        public IReadOnlyList<SystemBody> Bodies { get; }

        /// <summary>The body whose frame the plan is solved in.</summary>
        public int FrameBodyIndex { get; }

        /// <summary>How large a body is as an occluder, in metres, or zero for an index that names no body.</summary>
        public Func<int, double> OccludingRadius { get; }
    }

    /// <summary>
    /// Builds one command centre's contact plan from what that centre has
    /// heard: each craft's last received <see cref="CraftState"/>, reckoned
    /// forward on the orbit it reported, over the ground stations and bodies of
    /// a <see cref="PlanGround"/>.
    ///
    /// <para>These are its only inputs, and that is the rule that keeps a plan
    /// from knowing anything its centre could not: nothing here can reach the
    /// game, the live link graph, a comms backend or the delay ledger, and
    /// <c>reckoned-plan-inputs.test.ts</c> fails the build if this file is
    /// given a way to.</para>
    /// </summary>
    public static class ReckonedPlan
    {
        /// <summary>
        /// The plan request for a centre that has heard <paramref name="heard"/>.
        /// A craft it has not heard of is not in the plan, nor is one it has
        /// heard is gone, nor one whose orbit cannot be reckoned.
        ///
        /// <para>A pair's link is the one read with the older of its two craft
        /// states, so it holds nothing newer than the centre has heard from both
        /// ends. A pair whose older state knows no link to the other end, because
        /// that end did not exist yet, is left out until newer news of it
        /// arrives.</para>
        /// </summary>
        /// <param name="heard">The newest state this centre has received of each craft.</param>
        /// <param name="ground">The stations and bodies.</param>
        /// <param name="fromUt">When the plan starts.</param>
        /// <param name="horizonSeconds">How far ahead it predicts.</param>
        public static ContactPlanRequest Request(
            IReadOnlyCollection<CraftState> heard, PlanGround ground, double fromUt, double horizonSeconds)
        {
            var craft = new List<CraftState>();
            var nodes = new List<PlanNode>();
            var unsettled = new List<string>();
            var retargets = new Dictionary<string, IRetargetModel>(StringComparer.Ordinal);
            foreach (var state in heard)
            {
                var node = state.ToPlanNode();
                if (node == null)
                {
                    continue;
                }
                craft.Add(state);
                if (state.Retarget != null)
                {
                    retargets[state.Id] = state.Retarget;
                }
                nodes.Add(node.RememberedAs(state.Motion));
                if (!state.Settled)
                {
                    unsettled.Add(state.Id);
                }
            }
            craft.Sort((a, b) => string.CompareOrdinal(a.Id, b.Id));
            nodes.Sort((a, b) => string.CompareOrdinal(a.Id, b.Id));
            nodes.AddRange(ground.Stations);

            var pairs = new List<PlanPair>();
            for (var i = 0; i < craft.Count; i++)
            {
                for (var j = i + 1; j < craft.Count; j++)
                {
                    var older = craft[i].CapturedUt <= craft[j].CapturedUt ? craft[i] : craft[j];
                    var newer = ReferenceEquals(older, craft[i]) ? craft[j] : craft[i];
                    AddPair(pairs, older, newer.Id, newer.BodyIndex, ground);
                }
                foreach (var station in ground.Stations)
                {
                    AddPair(pairs, craft[i], station.Id, station.BodyIndex, ground);
                }
            }

            return new ContactPlanRequest(
                nodes, pairs, new KeplerProvider(ground.Bodies), ground.FrameBodyIndex, fromUt, horizonSeconds, unsettled,
                retargets.Count == 0 ? null : new CompositeRetargetModel(retargets));
        }

        private static void AddPair(List<PlanPair> pairs, CraftState from, string toId, int toBodyIndex, PlanGround ground)
        {
            if (!from.Links.TryGetValue(toId, out var link))
            {
                return;
            }
            var occluders = Occluders(from.BodyIndex, toBodyIndex, ground);
            if (occluders == null)
            {
                return;
            }
            // A link model is made for its own craft as the first end, so a pair
            // that has one stays that way round. A pair without one is the same
            // pair either way round, and is always given in id order, so which of
            // two craft was read last never shows in the plan.
            var craftPair = toId.StartsWith(CraftStateRecorder.VesselPrefix, StringComparison.Ordinal);
            if (link.Link == null && craftPair && string.CompareOrdinal(toId, from.Id) < 0)
            {
                pairs.Add(new PlanPair(toId, from.Id, occluders, link.MaxRangeMeters));
                return;
            }
            pairs.Add(new PlanPair(from.Id, toId, occluders, link.MaxRangeMeters, link.Link));
        }

        /// <summary>
        /// The bodies that can come between the two ends: the patched-conic chain
        /// between their bodies, plus each end's own body, which the chain leaves
        /// out and which is the commonest occluder of all. Null when no path joins
        /// the two bodies.
        /// </summary>
        private static List<OccludingBody>? Occluders(int aBody, int bBody, PlanGround ground)
        {
            var chain = PatchedConicChain.OccludersBetween(aBody, bBody, ground.Bodies, ground.OccludingRadius);
            if (chain == null)
            {
                return null;
            }
            var seen = new HashSet<int>();
            var occluders = new List<OccludingBody>();
            foreach (var body in new[]
            {
                new OccludingBody(aBody, ground.OccludingRadius(aBody)),
                new OccludingBody(bBody, ground.OccludingRadius(bBody)),
            })
            {
                if (seen.Add(body.BodyIndex))
                {
                    occluders.Add(body);
                }
            }
            foreach (var body in chain)
            {
                if (seen.Add(body.BodyIndex))
                {
                    occluders.Add(body);
                }
            }
            return occluders;
        }
    }
}
