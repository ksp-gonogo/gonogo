using System.Collections.Generic;
using Sitrep.Contract;
using Sitrep.Propagation.Contacts;
using Sitrep.Propagation.Visibility;

namespace Sitrep.Host.Comms
{
    /// <summary>
    /// How one craft's radio reaches one other node, as it stood when the
    /// craft's state was read: the declared range, and the backend's link
    /// model with its dishes aimed where they were aimed then.
    /// </summary>
    public readonly struct CraftLink
    {
        public CraftLink(double? maxRangeMeters, IContactLinkModel? link)
        {
            MaxRangeMeters = maxRangeMeters;
            Link = link;
        }

        /// <summary>The longest distance the pair can talk over, in metres, or null when the backend states none.</summary>
        public double? MaxRangeMeters { get; }

        /// <summary>The backend's link model for the pair, or null to plan the pair on geometry and range alone.</summary>
        public IContactLinkModel? Link { get; }
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
            string? name = null)
        {
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
            new CraftState(Id, capturedUt, true, BodyIndex, Orbit, Surface, Secular, validUntilUt, plannable, links, Motion, true, Name);

        /// <summary>This state, marked as read while the craft's orbit was still changing.</summary>
        public CraftState Unsettled() =>
            new CraftState(Id, CapturedUt, Exists, BodyIndex, Orbit, Surface, Secular, ValidUntilUt, Plannable, Links, Motion, false, Name);

        /// <summary>This state, carrying the craft's name as it was read with it.</summary>
        public CraftState Named(string? name) =>
            new CraftState(Id, CapturedUt, Exists, BodyIndex, Orbit, Surface, Secular, ValidUntilUt, Plannable, Links, Motion, Settled, name);

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
