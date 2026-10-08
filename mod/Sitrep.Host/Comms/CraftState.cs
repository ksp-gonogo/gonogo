using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Propagation.Contacts;
using Sitrep.Propagation.Visibility;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// How one craft's radio reaches one other node, as it stood when the
    /// craft's state was read: the declared range, the backend's link model
    /// with its dishes aimed where they were aimed then, and what the backend
    /// says the link is worth.
    /// </summary>
    public readonly struct CraftLink
    {
        public CraftLink(double? maxRangeMeters, IContactLinkModel? link, IContactLinkStrength? strength = null)
        {
            MaxRangeMeters = maxRangeMeters;
            Link = link;
            Strength = strength;
        }

        /// <summary>The longest distance the pair can talk over, in metres, or null when the backend states none.</summary>
        public double? MaxRangeMeters { get; }

        /// <summary>The backend's link model for the pair, or null to plan the pair on geometry and range alone.</summary>
        public IContactLinkModel? Link { get; }

        /// <summary>What the backend says the pair's link is worth at a separation, or null when it states no strength.</summary>
        public IContactLinkStrength? Strength { get; }
    }

    /// <summary>
    /// Everything a contact plan needs to know about one craft, read at one
    /// instant: that it exists, where it is going, and how its radio reaches
    /// every other node. One of these is recorded on the craft's own node
    /// whenever any of it changes, so each command centre hears of the change
    /// one of its own light-times later and plans from what it has heard.
    ///
    /// <para>Never sent to a client. It carries the backend's link models,
    /// which are code and not data.</para>
    /// </summary>
    public sealed class CraftState
    {
        private static readonly IReadOnlyDictionary<string, CraftLink> NoLinks = new Dictionary<string, CraftLink>();

        private CraftState(
            string id,
            double capturedUt,
            bool exists,
            int bodyIndex,
            OrbitElements? orbit,
            RotatingGroundStation? surface,
            SecularOrbit? secular,
            double? validUntilUt,
            bool plannable,
            IReadOnlyDictionary<string, CraftLink> links,
            object? motion,
            bool settled,
            string? name = null,
            IReadOnlyDictionary<string, object?>? roster = null)
        {
            Roster = roster;
            Name = name;
            Settled = settled;
            Motion = motion ?? new object();
            Id = id;
            CapturedUt = capturedUt;
            Exists = exists;
            BodyIndex = bodyIndex;
            Orbit = orbit;
            Surface = surface;
            Secular = secular;
            ValidUntilUt = validUntilUt;
            Plannable = plannable;
            Links = links;
        }

        /// <summary>The craft's node id, <c>"vessel:&lt;guid&gt;"</c>.</summary>
        public string Id { get; }

        /// <summary>The craft's name as it stood when this was read, or null when none was read.</summary>
        public string? Name { get; }

        /// <summary>
        /// The craft's entry on <c>system.vessels</c> as it stood when this was
        /// read: its name and type, its situation, its crew, its orbit. Null
        /// for a state read with no roster to hand.
        /// </summary>
        public IReadOnlyDictionary<string, object?>? Roster { get; }

        /// <summary>
        /// The craft's entry on <c>commandCentre.roster</c> as it stood when
        /// this was read, or null for a craft that was not a command centre
        /// then. A centre lists the craft as one from when this reaches it.
        /// </summary>
        public Sitrep.Contract.CommandCentreEntry? Centre { get; private set; }

        /// <summary>
        /// This state, saying whether the craft was a command centre when it
        /// was read. Said last, after every other change to a state, each of
        /// which makes a state that says nothing of it.
        /// </summary>
        public CraftState AsCentre(Sitrep.Contract.CommandCentreEntry? centre)
        {
            var said = (CraftState)MemberwiseClone();
            said.Centre = centre;
            return said;
        }

        /// <summary>When this was read off the craft.</summary>
        public double CapturedUt { get; }

        /// <summary>False for the last thing a craft says: that it is gone.</summary>
        public bool Exists { get; }

        /// <summary>The body the craft orbits, or stands on.</summary>
        public int BodyIndex { get; }

        /// <summary>The craft's orbit, or null for one standing on a surface.</summary>
        public OrbitElements? Orbit { get; }

        /// <summary>The craft's place on its body, for one standing on the surface.</summary>
        public RotatingGroundStation? Surface { get; }

        /// <summary>The drift the orbit is carried forward with, or null to carry it on its conic.</summary>
        public SecularOrbit? Secular { get; }

        /// <summary>How far ahead the orbit can be trusted, or null for as far as anyone plans.</summary>
        public double? ValidUntilUt { get; }

        /// <summary>False for a craft whose propagator could not say how far its orbit can be trusted: it is left out of every plan rather than trusted for all of it.</summary>
        public bool Plannable { get; }

        /// <summary>
        /// False for a craft read while its orbit was still changing: it is
        /// reckoned on the conic it was on at that instant, which it has since
        /// left, until a later state finds it holding still.
        /// </summary>
        public bool Settled { get; }

        /// <summary>The craft's link to each other node that existed when this was read, by that node's id.</summary>
        public IReadOnlyDictionary<string, CraftLink> Links { get; }

        /// <summary>
        /// What the craft's dishes could do if turned, as they stood when this was
        /// read, or null when the craft has none it would turn or the backend turns
        /// none. Code like <see cref="Links"/>' models, so never sent to a client.
        /// </summary>
        public IRetargetModel? Retarget { get; private set; }

        /// <summary>This state, carrying what the craft's dishes could do if turned.</summary>
        public CraftState WithRetarget(IRetargetModel? retarget)
        {
            var carried = (CraftState)MemberwiseClone();
            carried.Retarget = retarget;
            return carried;
        }

        /// <summary>
        /// Stands for where the craft is going: two states carrying the same
        /// object are of the same craft on the same orbit, or at the same place
        /// on the surface, and differ only in their links and in when they were
        /// read. Solved positions are remembered under it.
        /// </summary>
        public object Motion { get; }

        public static CraftState Orbiting(
            string id,
            double capturedUt,
            int bodyIndex,
            OrbitElements orbit,
            SecularOrbit? secular,
            double? validUntilUt,
            bool plannable,
            IReadOnlyDictionary<string, CraftLink> links,
            bool settled = true) =>
            new CraftState(id, capturedUt, true, bodyIndex, orbit, null, secular, validUntilUt, plannable, links, null, settled);

        public static CraftState Landed(
            string id, double capturedUt, int bodyIndex, RotatingGroundStation surface, IReadOnlyDictionary<string, CraftLink> links) =>
            new CraftState(id, capturedUt, true, bodyIndex, null, surface, null, null, true, links, null, true);

        /// <summary>The craft is gone: destroyed, recovered, or docked into another.</summary>
        public static CraftState Gone(string id, double capturedUt) =>
            new CraftState(id, capturedUt, false, -1, null, null, null, null, false, NoLinks, null, true);

        /// <summary>
        /// This craft still going where it was, read again at
        /// <paramref name="capturedUt"/>: the same orbit or place and the same
        /// <see cref="Motion"/>, with its links and how far its orbit can be
        /// trusted as they stand now. Having been found where it was, it is
        /// settled.
        /// </summary>
        public CraftState ReadAgain(
            double capturedUt, double? validUntilUt, bool plannable, IReadOnlyDictionary<string, CraftLink> links) =>
            new CraftState(Id, capturedUt, true, BodyIndex, Orbit, Surface, Secular, validUntilUt, plannable, links, Motion, true, Name, Roster).WithRetarget(Retarget);

        /// <summary>This state, marked as read while the craft's orbit was still changing.</summary>
        public CraftState Unsettled() =>
            new CraftState(Id, CapturedUt, Exists, BodyIndex, Orbit, Surface, Secular, ValidUntilUt, Plannable, Links, Motion, false, Name, Roster).WithRetarget(Retarget);

        /// <summary>
        /// This craft as it was last heard, where it was seen to be at
        /// <paramref name="seenUt"/>: its links, its name and whether it is a
        /// command centre unchanged, since a sighting says none of them.
        /// </summary>
        /// <param name="place">Where it was seen to be going, or null when the sighting read no orbit, which leaves it going where it was heard to be.</param>
        /// <param name="roster">Its entry as heard, with where it is as seen.</param>
        public CraftState SeenAt(double seenUt, CraftState? place, IReadOnlyDictionary<string, object?>? roster)
        {
            var from = place ?? this;
            var seen = new CraftState(
                Id, seenUt, true, from.BodyIndex, from.Orbit, from.Surface, from.Secular, from.ValidUntilUt, from.Plannable, Links, from.Motion, from.Settled, Name, roster);
            seen.Centre = Centre;
            seen.Retarget = Retarget;
            return seen;
        }

        /// <summary>
        /// This state, listed as the craft was <paramref name="before"/> where
        /// it was read while the game listed nothing for it. The game lists
        /// craft only while a flight is running, so a state read from the space
        /// centre, the tracking station or the editor has no entry of its own;
        /// that is the game not saying, not the craft no longer being listed.
        /// </summary>
        public CraftState ListedAsBefore(CraftState? before)
        {
            if (!Exists || Roster != null || before?.Roster == null)
            {
                return this;
            }
            return Listed(before.Roster).AsCentre(Centre);
        }

        /// <summary>Only where this craft is going, as a sighting carries it: no links, no name, no entry and nothing of whether it is a command centre.</summary>
        public CraftState PlaceOnly() =>
            new CraftState(Id, CapturedUt, Exists, BodyIndex, Orbit, Surface, Secular, ValidUntilUt, Plannable, NoLinks, Motion, Settled);

        /// <summary>This state, carrying the craft's name as it was read with it.</summary>
        public CraftState Named(string? name) =>
            new CraftState(Id, CapturedUt, Exists, BodyIndex, Orbit, Surface, Secular, ValidUntilUt, Plannable, Links, Motion, Settled, name, Roster).WithRetarget(Retarget);

        /// <summary>This state, carrying the craft's roster entry as it was read with it.</summary>
        public CraftState Listed(IReadOnlyDictionary<string, object?>? roster) =>
            new CraftState(Id, CapturedUt, Exists, BodyIndex, Orbit, Surface, Secular, ValidUntilUt, Plannable, Links, Motion, Settled, Name, roster).WithRetarget(Retarget);

        /// <summary>
        /// A craft that carries no radio: it exists and is listed, and no
        /// contact plan includes it, since nothing can be sent to it or heard
        /// from it.
        /// </summary>
        public static CraftState WithoutARadio(string id, double capturedUt, IReadOnlyDictionary<string, object?>? roster) =>
            new CraftState(id, capturedUt, true, -1, null, null, null, null, false, NoLinks, null, true, null, roster);

        /// <summary>The craft as a contact plan carries it, or null for one that is gone or cannot be planned.</summary>
        public PlanNode? ToPlanNode()
        {
            if (!Exists || !Plannable)
            {
                return null;
            }
            if (Surface != null)
            {
                return PlanNode.OnSurface(Id, BodyIndex, Surface.Value);
            }
            var target = PropagationTarget.Vessel(Id, BodyIndex, Orbit!.Value);
            return Secular != null
                ? PlanNode.Drifting(Id, target, Secular.Value, ValidUntilUt)
                : PlanNode.Orbiting(Id, target, ValidUntilUt);
        }
    }
}
