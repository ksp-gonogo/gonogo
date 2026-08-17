namespace Sitrep.Propagation
{
    /// <summary>What kind of thing a <see cref="PropagationTarget"/> names.</summary>
    public enum PropagationTargetKind
    {
        Vessel,
        Body,
    }

    /// <summary>
    /// WHAT to propagate, as an identity a provider can resolve, rather than as a
    /// description a provider is obliged to believe.
    ///
    /// <para>The distinction is the reason this type exists. A provider handed only
    /// <see cref="OrbitElements"/> has been handed a conic, so whatever it does
    /// internally it can only ever answer in conics: the argument itself is the
    /// two-body assumption. A target instead names the object, and carries
    /// <see cref="Osculating"/> as the payload the two-body vanilla happens to need.
    /// A provider backed by a different physics resolves <see cref="Id"/> or
    /// <see cref="BodyIndex"/> against its own model and ignores the elements
    /// entirely.</para>
    ///
    /// <para><see cref="Osculating"/> is nullable precisely so that "I have no conic
    /// for this" is expressible. <see cref="KeplerProvider"/> declines such a target
    /// rather than substituting anything.</para>
    /// </summary>
    public readonly struct PropagationTarget
    {
        private PropagationTarget(
            PropagationTargetKind kind,
            string id,
            int bodyIndex,
            int parentBodyIndex,
            OrbitElements? osculating)
        {
            Kind = kind;
            Id = id;
            BodyIndex = bodyIndex;
            ParentBodyIndex = parentBodyIndex;
            Osculating = osculating;
        }

        public PropagationTargetKind Kind { get; }

        /// <summary>The vessel's stable id, or null for a body (which is named by <see cref="BodyIndex"/>).</summary>
        public string? Id { get; }

        /// <summary>Index into the body table for a <see cref="PropagationTargetKind.Body"/> target, or -1 for a vessel.</summary>
        public int BodyIndex { get; }

        /// <summary>
        /// Index of the body this target orbits. A frame centred on anything else
        /// requires walking the body hierarchy, which is why a provider must be
        /// asked (<see cref="IPropagationProvider.CanPropagate(PropagationTarget, PropagationFrame, double, double)"/>)
        /// rather than assumed capable.
        /// </summary>
        public int ParentBodyIndex { get; }

        /// <summary>
        /// The target's elements about <see cref="ParentBodyIndex"/> at their own
        /// epoch. Null when the caller has none, which is not an error.
        /// </summary>
        public OrbitElements? Osculating { get; }

        public static PropagationTarget Vessel(string id, int parentBodyIndex, OrbitElements? osculating) =>
            new PropagationTarget(PropagationTargetKind.Vessel, id, -1, parentBodyIndex, osculating);

        public static PropagationTarget Body(int bodyIndex, int parentBodyIndex, OrbitElements? osculating) =>
            new PropagationTarget(PropagationTargetKind.Body, null, bodyIndex, parentBodyIndex, osculating);

        /// <summary>
        /// A target known only by its elements, relative to whichever body the
        /// caller is already working against. Pairs with
        /// <see cref="PropagationFrame.Unnamed"/>, and the two together assert
        /// exactly the invariant such a caller already relies on: that the elements
        /// and the frame share a centre.
        ///
        /// <para>TRANSITIONAL. It exists for callers that hold elements but no body
        /// table, which today means the visibility geometries. Those are the same
        /// callers that will gain a real body index when the hierarchy walk moves
        /// inside the provider; at that point this factory has no users left. It is
        /// deliberately not a way to keep passing conics around: a target built this
        /// way can only ever be solved in its own unnamed frame, so it buys nothing
        /// except compilation for code that has not been converted yet.</para>
        /// </summary>
        public static PropagationTarget RelativeToFrame(OrbitElements osculating) =>
            new PropagationTarget(
                PropagationTargetKind.Body, null, -1, PropagationFrame.UnnamedCentre, osculating);
    }

    /// <summary>
    /// The frame an answer must be expressed in: centred on one body, non-rotating,
    /// the same Z-up inertial convention <see cref="KeplerProvider"/> emits.
    ///
    /// <para>Making the frame an argument is what keeps hierarchy-walking inside a
    /// provider instead of in every caller. Callers that need a vessel's position
    /// relative to some OTHER body than the one it orbits ask for that frame
    /// directly; how the answer is reached (summing conics up and down a body chain,
    /// or reading it straight out of an n-body integrator) is the provider's
    /// business and not the caller's.</para>
    /// </summary>
    public readonly struct PropagationFrame
    {
        private PropagationFrame(int centreBodyIndex)
        {
            CentreBodyIndex = centreBodyIndex;
        }

        /// <summary>
        /// The centre index used by <see cref="PropagationTarget.RelativeToFrame"/>
        /// and <see cref="Unnamed"/>: "whatever body these elements are measured
        /// against". Negative so it can never collide with a real body index.
        /// </summary>
        public const int UnnamedCentre = -1;

        public int CentreBodyIndex { get; }

        public static PropagationFrame CentredOn(int bodyIndex) => new PropagationFrame(bodyIndex);

        /// <summary>
        /// The frame a <see cref="PropagationTarget.RelativeToFrame"/> target is
        /// measured in. TRANSITIONAL, and see that factory for why.
        /// </summary>
        public static PropagationFrame Unnamed => new PropagationFrame(UnnamedCentre);
    }
}
