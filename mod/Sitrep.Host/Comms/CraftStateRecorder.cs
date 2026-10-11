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
    /// <para>A craft is also read when its own entry on <c>system.vessels</c>
    /// changes in anything but its orbit and its link: its name, its type, its
    /// situation, its crew. A craft with no radio cannot be read again at all,
    /// since nothing it does can be sent: it is noted once, when it is first in
    /// the game, and once more when it is gone.</para>
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

        /// <summary>One sighting, and the light-time from the object to each command centre when it was made, in seconds by centre id.</summary>
        public sealed class Sighted
        {
            public Sighted(CraftSighting sighting, IReadOnlyDictionary<string, double> lightSeconds)
            {
                Sighting = sighting;
                LightSeconds = lightSeconds;
            }

            public CraftSighting Sighting { get; }

            public IReadOnlyDictionary<string, double> LightSeconds { get; }
        }

        /// <summary>What <see cref="Capture"/> found, for the Courier thread to record.</summary>
        public sealed class Batch
        {
            public Batch(
                double ut,
                IReadOnlyList<string> present,
                IReadOnlyList<CraftState> states,
                IReadOnlyList<string> gone,
                IReadOnlyList<Sighted>? sightings = null,
                IReadOnlyList<string>? known = null)
            {
                Ut = ut;
                Present = present;
                States = states;
                Gone = gone;
                Sightings = sightings ?? new Sighted[0];
                Known = known ?? present;
            }

            /// <summary>The objects whose place was seen afresh this pass, each with how long its light takes to reach each centre.</summary>
            public IReadOnlyList<Sighted> Sightings { get; }

            /// <summary>Every craft there is anything to hear of, radio or not, by bare guid.</summary>
            public IReadOnlyList<string> Known { get; }

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

        /// <summary>What each object was last seen as, and when, by node id.</summary>
        private readonly Dictionary<string, (IReadOnlyDictionary<string, object?>? Listed, double Ut)> _sighted =
            new Dictionary<string, (IReadOnlyDictionary<string, object?>?, double)>(StringComparer.Ordinal);

        /// <summary>The light-times of the last pass, for an object that is gone by this one and can no longer be measured.</summary>
        private IReadOnlyDictionary<string, IReadOnlyDictionary<string, double>>? _lastSight;

        /// <summary>The centres the last pass measured to. A centre that is new has seen nothing, so everything is seen again for it.</summary>
        private HashSet<string> _sightCentres = new HashSet<string>(StringComparer.Ordinal);
        private int _readAll;

        /// <summary>Each craft's command-centre entry as it was last said, by node id: null for one that was not a centre.</summary>
        private readonly Dictionary<string, Sitrep.Contract.CommandCentreEntry?> _centreSaid =
            new Dictionary<string, Sitrep.Contract.CommandCentreEntry?>(StringComparer.Ordinal);

        /// <summary>Has every craft read afresh on the next pass: the timeline was reset, and what was recorded ahead of it is gone. Safe from any thread.</summary>
        public void ReadAllAgain() => Interlocked.Exchange(ref _readAll, 1);

        /// <summary>MAIN THREAD: the craft whose state is out of date, each read now.</summary>
        /// <param name="roster">Each craft's <c>system.vessels</c> entry as the game shows it now, by node id, or null when the game lists none.</param>
        public Batch Capture(
            ContactGameLook look,
            double ut,
            Kernel? kernel,
            IReadOnlyDictionary<string, IReadOnlyDictionary<string, object?>>? roster = null)
        {
            if (Interlocked.Exchange(ref _readAll, 0) != 0)
            {
                _read.Clear();
                _sighted.Clear();
                _lastSight = null;
                _centreSaid.Clear();
            }

            var sight = look.Sight;
            var sightAgain = NewCentreIn(sight);
            var sightings = new List<Sighted>();

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
                IReadOnlyDictionary<string, object?>? listed = null;
                roster?.TryGetValue(node.Id, out listed);
                var state = Due(node, look, ut, kernel, listed);
                _centreSaid.TryGetValue(node.Id, out var centreSaid);
                if (state == null && !CentreRoster.Same(centreSaid, node.Centre) && _read.TryGetValue(node.Id, out var last))
                {
                    // It became a command centre, or stopped being one, and nothing
                    // else about it changed: the same craft, said again as it now is.
                    state = last.State.ReadAgain(ut, last.State.ValidUntilUt, last.State.Plannable, last.State.Links)
                        .Named(last.State.Name)
                        .Listed(last.State.Roster);
                    state = last.State.Settled ? state : state.Unsettled();
                    _read[node.Id] = new Read(last.Node, state);
                }
                if (state != null)
                {
                    _centreSaid[node.Id] = node.Centre;
                    states.Add(state.AsCentre(node.Centre));
                }
                // Seen whenever it has something new to say, since that is when where it is going is read.
                if (sight != null
                    && sight.TryGetValue(node.Id, out var light)
                    && (state != null || sightAgain || !_sighted.ContainsKey(node.Id))
                    && _read.TryGetValue(node.Id, out var read))
                {
                    var sighting = CraftSighting.Of(node.Id, ut, listed, read.State.PlaceOnly());
                    _sighted[node.Id] = (sighting.Listed, ut);
                    sightings.Add(new Sighted(sighting, light));
                }
            }

            var known = new List<string>(present);
            if (roster != null)
            {
                foreach (var entry in roster)
                {
                    if (seen.Contains(entry.Key))
                    {
                        continue;
                    }
                    known.Add(GuidOf(entry.Key));
                    // No radio to read this pass: debris, a flag, an asteroid, a
                    // crewed craft with no antenna. It says nothing, and is seen.
                    if (sight == null || !sight.TryGetValue(entry.Key, out var light))
                    {
                        continue;
                    }
                    var sighting = CraftSighting.Of(entry.Key, ut, entry.Value);
                    if (sightAgain || SeenAfresh(entry.Key, sighting.Listed, ut))
                    {
                        _sighted[entry.Key] = (sighting.Listed, ut);
                        sightings.Add(new Sighted(sighting, light));
                    }
                }
                foreach (var id in new List<string>(_sighted.Keys))
                {
                    if (seen.Contains(id) || roster.ContainsKey(id))
                    {
                        continue;
                    }
                    _sighted.Remove(id);
                    // It can no longer be measured, so its going is seen over the distance it was last at.
                    if (_lastSight != null && _lastSight.TryGetValue(id, out var light))
                    {
                        sightings.Add(new Sighted(CraftSighting.Gone(id, ut), light));
                    }
                }
            }
            _lastSight = sight;

            var gone = new List<string>();
            foreach (var id in new List<string>(_read.Keys))
            {
                // Still in the game with no radio to read this pass is not gone.
                if (!seen.Contains(id) && (roster == null || !roster.ContainsKey(id)) && !InTheGame(look, id))
                {
                    _read.Remove(id);
                    gone.Add(GuidOf(id));
                }
            }
            StatesRecordedBudget.Record(states.Count + sightings.Count, ut);
            return new Batch(ut, present, states, gone, sightings, known);
        }

        /// <summary>Whether the game's own list of vessels, where it gives one, still holds the craft.</summary>
        private static bool InTheGame(ContactGameLook look, string id)
        {
            if (look.Vessels == null)
            {
                return false;
            }
            var guid = GuidOf(id);
            foreach (var vessel in look.Vessels)
            {
                if (vessel == guid)
                {
                    return true;
                }
            }
            return false;
        }

        /// <summary>Whether this pass measures to a centre the last one did not, and notes the centres it measures to.</summary>
        private bool NewCentreIn(IReadOnlyDictionary<string, IReadOnlyDictionary<string, double>>? sight)
        {
            if (sight == null)
            {
                return false;
            }
            var centres = new HashSet<string>(StringComparer.Ordinal);
            foreach (var row in sight.Values)
            {
                centres.UnionWith(row.Keys);
            }
            var grew = !centres.IsSubsetOf(_sightCentres);
            _sightCentres = centres;
            return grew;
        }

        /// <summary>
        /// Whether an object with no radio is to be seen again: it has not been
        /// seen, or it is in another situation or round another body or
        /// tracked under another name, or it has moved off the orbit it was
        /// last seen on and long enough ago that a drifting one is not seen
        /// every pass.
        /// </summary>
        private bool SeenAfresh(string id, IReadOnlyDictionary<string, object?>? listed, double ut)
        {
            if (!_sighted.TryGetValue(id, out var last) || ut < last.Ut)
            {
                return true;
            }
            if (CraftSighting.SamePlace(last.Listed, listed))
            {
                return false;
            }
            return ut >= last.Ut + ContactPlanSchedule.MinDriftReplanSeconds || Discretely(last.Listed, listed);
        }

        /// <summary>Whether two listings differ in anything but the orbit.</summary>
        private static bool Discretely(IReadOnlyDictionary<string, object?>? was, IReadOnlyDictionary<string, object?>? now)
        {
            if (was == null || now == null)
            {
                return true;
            }
            foreach (var key in new[] { "vesselId", "name", "vesselType", "situation", "bodyIndex", "landedAt", "latitude", "longitude" })
            {
                was.TryGetValue(key, out var a);
                now.TryGetValue(key, out var b);
                if (!SameListedFact(a, b))
                {
                    return true;
                }
            }
            return (was.TryGetValue("orbit", out var o1) && o1 != null) != (now.TryGetValue("orbit", out var o2) && o2 != null);
        }

        /// <summary>
        /// Whether two listed facts are the same one. A coordinate is read off a craft that rests on the ground, where physics keeps nudging it by far less than anything a client could draw, so two readings within a metre or so of each other are one place and do not make the craft re-listed.
        /// </summary>
        private static bool SameListedFact(object? a, object? b) =>
            a is double x && b is double y ? Math.Abs(x - y) <= CoordinateToleranceDegrees : Equals(a, b);

        private const double CoordinateToleranceDegrees = 1e-4;

        /// <summary>The roster keys a craft is read again for. Its orbit is read when it moves, and its link is told by its own report.</summary>
        private static readonly string[] ListedFacts = { "name", "vesselType", "situation", "bodyIndex", "landedAt", "latitude", "longitude", "crewCount", "crewCapacity", "commsControlSource" };

        private static bool ListedDifferently(IReadOnlyDictionary<string, object?>? was, IReadOnlyDictionary<string, object?>? now)
        {
            if (now == null)
            {
                return false;
            }
            if (was == null)
            {
                return true;
            }
            foreach (var key in ListedFacts)
            {
                was.TryGetValue(key, out var a);
                now.TryGetValue(key, out var b);
                if (!SameListedFact(a, b))
                {
                    return true;
                }
            }
            return false;
        }

        /// <summary>The craft's state read now, when its last one is out of date, or null while that one still stands.</summary>
        private CraftState? Due(
            ContactGameNode node, ContactGameLook look, double ut, Kernel? kernel, IReadOnlyDictionary<string, object?>? listed)
        {
            if (listed == null && _read.TryGetValue(node.Id, out var before))
            {
                // The game lists nothing for it this pass, which is the game not saying: it is listed as it last was.
                listed = before.State.Roster;
            }
            if (!_read.TryGetValue(node.Id, out var last) || ut < last.State.CapturedUt)
            {
                var first = StateOf(node, look, ut, kernel).Listed(listed);
                _read[node.Id] = new Read(node, first);
                return first;
            }
            if (Moved(last, node, ut))
            {
                // An orbit that has changed since it was last read is, as far as
                // anyone can tell, still changing.
                var moving = node.Orbit.HasValue && last.Node.Orbit.HasValue
                    ? StateOf(node, look, ut, kernel).Listed(listed).Unsettled()
                    : StateOf(node, look, ut, kernel).Listed(listed);
                _read[node.Id] = new Read(node, moving);
                return moving;
            }
            var settling = !last.State.Settled && ut >= last.State.CapturedUt + ContactPlanSchedule.MinDriftReplanSeconds;
            if (!settling && ut < last.State.CapturedUt + LinkRefreshSeconds && !LacksALinkToANodeHere(last.State, look))
            {
                if (!ListedDifferently(last.State.Roster, listed))
                {
                    return null;
                }
                // Its crew, its situation or its name changed and its orbit did
                // not: the same craft going the same way, listed as it is now.
                var fresh = StateOf(node, look, ut, kernel);
                var relisted = last.State.ReadAgain(ut, fresh.ValidUntilUt, fresh.Plannable, fresh.Links).WithRetarget(fresh.Retarget).Named(fresh.Name).Listed(listed);
                if (!last.State.Settled)
                {
                    relisted = relisted.Unsettled();
                }
                _read[node.Id] = new Read(last.Node, relisted);
                return relisted;
            }
            // A seed is anchored to when it was asked for, so a craft carried on
            // one is read afresh each time.
            var read = StateOf(node, look, ut, kernel);
            var afresh = read.Secular != null || last.State.Secular != null;
            var again = (afresh ? read : last.State.ReadAgain(ut, read.ValidUntilUt, read.Plannable, read.Links).WithRetarget(read.Retarget).Named(read.Name))
                .Listed(listed);
            _read[node.Id] = new Read(afresh ? node : last.Node, again);
            return again;
        }

        /// <summary>
        /// Whether the game has a node the state holds no link to: one that
        /// arrived after the craft was read. A plan pairs two craft by the link
        /// the older of their states holds, so until the craft is read again it
        /// is planned as unable to reach the arrival. Nothing is read for a node
        /// that has left, because a centre learns of that when the craft's own
        /// light reaches it and not when another craft happens to be read.
        /// </summary>
        private static bool LacksALinkToANodeHere(CraftState state, ContactGameLook look)
        {
            foreach (var other in look.Nodes)
            {
                if (other.Id != state.Id && !state.Links.ContainsKey(other.Id))
                {
                    return true;
                }
            }
            return false;
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
            foreach (var sighted in batch.Sightings)
            {
                host.RecordCraftSighting(GuidOf(sighted.Sighting.Id), sighted.Sighting, batch.Ut, sighted.LightSeconds);
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
                    CommsElection.LinkModel(kernel, node.Radio, other.Radio, ut),
                    CommsElection.LinkStrength(kernel, node.Radio, other.Radio, ut));
            }
            var retarget = CommsElection.RetargetModel(kernel, node.Radio, ut);
            if (node.Surface != null)
            {
                return CraftState.Landed(node.Id, ut, node.BodyIndex, node.Surface.Value, links).WithRetarget(retarget);
            }

            // A craft with a secular seed is bounded by the seed's own span, not by
            // the conic's horizon, which bounds the very drift the seed carries.
            var target = PropagationTarget.Vessel(node.Id, node.BodyIndex, node.Orbit!.Value);
            var seed = ContactSeeds.Read(PropagationElection.Secular(kernel), target, ut);
            if (seed != null)
            {
                return CraftState.Orbiting(node.Id, ut, node.BodyIndex, node.Orbit.Value, seed, null, true, links).WithRetarget(retarget);
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
                links).WithRetarget(retarget);
        }
    }
}
