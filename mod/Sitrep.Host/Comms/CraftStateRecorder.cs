using System;
using System.Collections.Generic;
using System.Threading;
using Sitrep.Contract;
using Sitrep.Host.Propagation;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// Decides when a craft's <see cref="CraftState"/> is out of date and reads
    /// a new one: when the craft first appears, when its orbit or its place on
    /// the surface moves past the plan's tolerance, when a node arrives or
    /// leaves (every craft's links are to a different set of nodes), and when
    /// half a plan's horizon has passed, which is how a change the game gives
    /// no sign of, a dish re-aimed or an antenna retracted, is picked up.
    ///
    /// <para>A burn moves an orbit every tick, so a craft whose orbit is
    /// moving is read at most once per
    /// <see cref="ContactPlanSchedule.MinDriftReplanSeconds"/>.</para>
    /// </summary>
    public sealed class CraftStateRecorder
    {
        public const string VesselPrefix = "vessel:";

        /// <summary>
        /// Soft cap on craft states recorded per second of game time. A node
        /// arriving or leaving records every craft at once, so a busy save
        /// peaks at its craft count; sustained above this, the tolerances are
        /// reading noise as change.
        /// </summary>
        private static readonly PerfBudget StatesRecordedBudget = new PerfBudget(
            "CraftStateRecorder craft states recorded", threshold: 600, windowSec: 1.0, unit: "states");

        private sealed class Read
        {
            public Read(ContactGameNode node, double ut)
            {
                Node = node;
                Ut = ut;
            }

            public ContactGameNode Node { get; }

            public double Ut { get; }
        }

        /// <summary>What <see cref="Capture"/> found, for the Courier thread to record.</summary>
        public sealed class Batch
        {
            public Batch(double ut, IReadOnlyList<string> present, IReadOnlyList<CraftState> states, IReadOnlyList<string> gone)
            {
                Ut = ut;
                Present = present;
                States = states;
                Gone = gone;
            }

            public double Ut { get; }

            /// <summary>Every craft in the game now, by bare guid.</summary>
            public IReadOnlyList<string> Present { get; }

            /// <summary>The states read this pass.</summary>
            public IReadOnlyList<CraftState> States { get; }

            /// <summary>The craft that were in the game at the last pass and are not now, by bare guid.</summary>
            public IReadOnlyList<string> Gone { get; }
        }

        // Main-thread state, apart from the flag a timeline reset raises.
        private readonly Dictionary<string, Read> _read = new Dictionary<string, Read>(StringComparer.Ordinal);
        private HashSet<string> _nodeIds = new HashSet<string>(StringComparer.Ordinal);
        private int _readAll;

        /// <summary>Has every craft read afresh on the next pass: the timeline was reset, and what was recorded ahead of it is gone. Safe from any thread.</summary>
        public void ReadAllAgain() => Interlocked.Exchange(ref _readAll, 1);

        /// <summary>MAIN THREAD: the craft whose state is out of date, each read now.</summary>
        public Batch Capture(ContactGameLook look, double ut, Kernel? kernel)
        {
            var nodeIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var node in look.Nodes)
            {
                nodeIds.Add(node.Id);
            }
            var everything = Interlocked.Exchange(ref _readAll, 0) != 0 || !nodeIds.SetEquals(_nodeIds);
            _nodeIds = nodeIds;

            var present = new List<string>();
            var states = new List<CraftState>();
            foreach (var node in look.Nodes)
            {
                if (node.Station || !node.Id.StartsWith(VesselPrefix, StringComparison.Ordinal))
                {
                    continue;
                }
                present.Add(GuidOf(node.Id));
                if (!everything && _read.TryGetValue(node.Id, out var last) && !Due(last, node, ut))
                {
                    continue;
                }
                _read[node.Id] = new Read(node, ut);
                states.Add(StateOf(node, look, ut, kernel));
            }

            var gone = new List<string>();
            foreach (var id in new List<string>(_read.Keys))
            {
                if (!nodeIds.Contains(id))
                {
                    _read.Remove(id);
                    gone.Add(GuidOf(id));
                }
            }
            StatesRecordedBudget.Record(states.Count, ut);
            return new Batch(ut, present, states, gone);
        }

        /// <summary>COURIER THREAD: records what <see cref="Capture"/> read.</summary>
        public static void Record(Batch batch, ICraftStateHost host)
        {
            foreach (var vesselId in batch.Gone)
            {
                host.RecordCraftGone(vesselId, batch.Ut);
            }
            foreach (var vesselId in batch.Present)
            {
                host.NoteCraftPresent(vesselId);
            }
            foreach (var state in batch.States)
            {
                host.RecordCraftState(GuidOf(state.Id), state, batch.Ut);
            }
        }

        public static string GuidOf(string nodeId) => nodeId.Substring(VesselPrefix.Length);

        private static bool Due(Read last, ContactGameNode now, double ut)
        {
            if (ut < last.Ut || ut >= last.Ut + (ContactPlanSchedule.HorizonSeconds / 2.0))
            {
                return true;
            }
            var was = last.Node;
            if (was.BodyIndex != now.BodyIndex || was.Orbit.HasValue != now.Orbit.HasValue || was.Surface.HasValue != now.Surface.HasValue)
            {
                return true;
            }
            if (now.Surface.HasValue)
            {
                return (now.Surface.Value.PositionAt(0.0) - was.Surface!.Value.PositionAt(0.0)).Magnitude()
                    > ContactPlanSchedule.SurfaceToleranceMeters;
            }
            return now.Orbit.HasValue
                && ut >= last.Ut + ContactPlanSchedule.MinDriftReplanSeconds
                && ContactPlanSchedule.Moved(was.Orbit!.Value, now.Orbit.Value);
        }

        private static CraftState StateOf(ContactGameNode node, ContactGameLook look, double ut, Kernel? kernel)
        {
            var links = new Dictionary<string, CraftLink>(StringComparer.Ordinal);
            foreach (var other in look.Nodes)
            {
                if (other.Id == node.Id)
                {
                    continue;
                }
                links[other.Id] = new CraftLink(
                    CommsElection.ReachModel(kernel, node.Radio, other.Radio).MaxRangeMeters,
                    CommsElection.LinkModel(kernel, node.Radio, other.Radio, ut));
            }
            if (node.Surface != null)
            {
                return CraftState.Landed(node.Id, ut, node.BodyIndex, node.Surface.Value, links);
            }

            // A craft with a secular seed is bounded by the seed's own span, not by
            // the conic's horizon, which bounds the very drift the seed carries.
            var target = PropagationTarget.Vessel(node.Id, node.BodyIndex, node.Orbit!.Value);
            var seed = ContactSeeds.Read(PropagationElection.Secular(kernel), target, ut);
            if (seed != null)
            {
                return CraftState.Orbiting(node.Id, ut, node.BodyIndex, node.Orbit.Value, seed, null, true, links);
            }
            var horizon = PropagationElection.HorizonFor(kernel, target, ut);
            return CraftState.Orbiting(
                node.Id,
                ut,
                node.BodyIndex,
                node.Orbit.Value,
                null,
                horizon.Kind == PropagationHorizonKind.Until ? horizon.UntilUt : null,
                horizon.Kind != PropagationHorizonKind.Unspecified,
                links);
        }
    }
}
