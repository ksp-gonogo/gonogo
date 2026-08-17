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
            string? id,
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

        /// <summary>Index into the provider's body table for a <see cref="PropagationTargetKind.Body"/> target, or -1 for a vessel.</summary>
        public int BodyIndex { get; }

        /// <summary>
        /// Index of the body this target orbits, or -1 when the caller does not know
        /// it (and, for a body, always, because which body a body orbits is the
        /// provider's to know rather than the caller's to assert). A frame centred on
        /// anything else requires walking the body hierarchy, which is why a provider
        /// must be asked
        /// (<see cref="IPropagationProvider.CanPropagate(PropagationTarget, PropagationFrame, double, double)"/>)
        /// rather than assumed capable.
        /// </summary>
        public int ParentBodyIndex { get; }

        /// <summary>
        /// The target's elements about <see cref="ParentBodyIndex"/> at their own
        /// epoch. Null when the caller has none, which is not an error.
        /// </summary>
        public OrbitElements? Osculating { get; }

        /// <summary>
        /// A vessel, DESCRIBED. A vessel comes with its elements because no provider
        /// has a registry to resolve a vessel id against: whatever physics a provider
        /// runs, the craft it is asked about is one the caller is holding a sample
        /// of. Contrast <see cref="Body"/>.
        /// </summary>
        public static PropagationTarget Vessel(string id, int parentBodyIndex, OrbitElements? osculating) =>
            new PropagationTarget(PropagationTargetKind.Vessel, id, -1, parentBodyIndex, osculating);

        /// <summary>
        /// A body, NAMED. No elements and no parent: a provider knows where the
        /// bodies are, and a caller that supplied its own copy would be handing over
        /// a second opinion the provider would then have to choose between.
        ///
        /// <para>This asymmetry with <see cref="Vessel"/> is the point. It is what
        /// lets an occlusion pass ask where each occluding body is without holding a
        /// conic for any of them, and so what lets the visibility geometries stop
        /// composing conics themselves.</para>
        /// </summary>
        public static PropagationTarget Body(int bodyIndex) =>
            new PropagationTarget(PropagationTargetKind.Body, null, bodyIndex, -1, null);
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

        public int CentreBodyIndex { get; }

        public static PropagationFrame CentredOn(int bodyIndex) => new PropagationFrame(bodyIndex);
    }
}
