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
    /// the surface moves past the plan's tolerance, and every
    /// <see cref="LinkRefreshSeconds"/> whatever has happened, which is how a
    /// change the game gives no sign of, a dish re-aimed or an antenna
    /// retracted, is picked up, and how a craft's links come to name a craft
    /// launched since it was last read.
    ///
    /// <para><b>Nothing another craft does has a craft read.</b> A craft read
    /// because a distant one was launched or destroyed would carry that news to
    /// each centre at its own light-time, which can be far shorter than the
    /// distant craft's.</para>
    ///
    /// <para>A burn moves an orbit every tick, so a craft whose orbit is
    /// moving is read at most once per
    /// <see cref="ContactPlanSchedule.MinDriftReplanSeconds"/>, and each such
    /// state says it is not settled. Once the orbit has held still for that
    /// long the craft is read again, settled. A craft read again without
    /// having moved keeps the orbit it was first read on, so an n-body
    /// propagator's wobble never reaches a plan.</para>
    /// </summary>
    public sealed class CraftStateRecorder
    {
        public const string VesselPrefix = "vessel:";

        /// <summary>
        /// Soft cap on craft states recorded per second of game time. A game
        /// load reads every craft at once, so a busy save peaks at its craft
        /// count; sustained above this, the tolerances are reading noise as
        /// change.
        /// </summary>
        private static readonly PerfBudget StatesRecordedBudget = new PerfBudget(
            "CraftStateRecorder craft states recorded", threshold: 600, windowSec: 1.0, unit: "states");

        /// <summary>How often a craft that has not moved is read again, in seconds of game time.</summary>
        public const double LinkRefreshSeconds = 600.0;

        private sealed class Read
        {
            public Read(ContactGameNode node, CraftState state)
            {
                Node = node;
                State = state;
            }

            /// <summary>The craft as the game showed it when its orbit or place was last taken.</summary>
            public ContactGameNode Node { get; }

            public CraftState State { get; }
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
        private int _readAll;

        /// <summary>Has every craft read afresh on the next pass: the timeline was reset, and what was recorded ahead of it is gone. Safe from any thread.</summary>
        public void ReadAllAgain() => Interlocked.Exchange(ref _readAll, 1);

        /// <summary>MAIN THREAD: the craft whose state is out of date, each read now.</summary>
        public Batch Capture(ContactGameLook look, double ut, Kernel? kernel)
        {
            if (Interlocked.Exchange(ref _readAll, 0) != 0)
            {
                _read.Clear();
            }

            var seen = new HashSet<string>(StringComparer.Ordinal);
            var present = new List<string>();
            var states = new List<CraftState>();
            foreach (var node in look.Nodes)
            {
                if (node.Station || !node.Id.StartsWith(VesselPrefix, StringComparison.Ordinal))
                {
                    continue;
                }
                seen.Add(node.Id);
                present.Add(GuidOf(node.Id));
                var state = Due(node, look, ut, kernel);
                if (state != null)
                {
                    states.Add(state);
                }
            }

            var gone = new List<string>();
            foreach (var id in new List<string>(_read.Keys))
            {
                if (!seen.Contains(id))
                {
                    _read.Remove(id);
                    gone.Add(GuidOf(id));
                }
            }
            StatesRecordedBudget.Record(states.Count, ut);
            return new Batch(ut, present, states, gone);
        }

        /// <summary>The craft's state read now, when its last one is out of date, or null while that one still stands.</summary>
        private CraftState? Due(ContactGameNode node, ContactGameLook look, double ut, Kernel? kernel)
        {
            if (!_read.TryGetValue(node.Id, out var last) || ut < last.State.CapturedUt)
            {
                var first = StateOf(node, look, ut, kernel);
                _read[node.Id] = new Read(node, first);
                return first;
            }
            if (Moved(last, node, ut))
            {
                // An orbit that has changed since it was last read is, as far as
                // anyone can tell, still changing.
                var moving = node.Orbit.HasValue && last.Node.Orbit.HasValue
                    ? StateOf(node, look, ut, kernel).Unsettled()
                    : StateOf(node, look, ut, kernel);
                _read[node.Id] = new Read(node, moving);
                return moving;
            }
            var settling = !last.State.Settled && ut >= last.State.CapturedUt + ContactPlanSchedule.MinDriftReplanSeconds;
            if (!settling && ut < last.State.CapturedUt + LinkRefreshSeconds)
            {
                return null;
            }
            // A seed is anchored to when it was asked for, so a craft carried on
            // one is read afresh each time.
            var read = StateOf(node, look, ut, kernel);
            var again = read.Secular != null || last.State.Secular != null
                ? read
                : last.State.ReadAgain(ut, read.ValidUntilUt, read.Plannable, read.Links).Named(read.Name);
            _read[node.Id] = new Read(ReferenceEquals(again, read) ? node : last.Node, again);
            return again;
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
                host.NoteCraftPresent(vesselId, batch.Ut);
            }
            foreach (var state in batch.States)
            {
                host.RecordCraftState(GuidOf(state.Id), state, batch.Ut);
            }
        }

        public static string GuidOf(string nodeId) => nodeId.Substring(VesselPrefix.Length);

        private static bool Moved(Read last, ContactGameNode now, double ut)
        {
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
                && ut >= last.State.CapturedUt + ContactPlanSchedule.MinDriftReplanSeconds
                && ContactPlanSchedule.Moved(was.Orbit!.Value, now.Orbit.Value);
        }

        private static CraftState StateOf(ContactGameNode node, ContactGameLook look, double ut, Kernel? kernel) =>
            Unnamed(node, look, ut, kernel).Named(node.DisplayName);

        private static CraftState Unnamed(ContactGameNode node, ContactGameLook look, double ut, Kernel? kernel)
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
