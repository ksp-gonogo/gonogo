namespace Sitrep.Contract
{
    /// <summary>What kind of thing a <see cref="PropagationTarget"/> names.</summary>
    /// <category>Propagation and models</category>
    public enum PropagationTargetKind
    {
        /// <summary>A craft, described by its id and, when the caller has them, its osculating elements.</summary>
        Vessel,

        /// <summary>A celestial body, named by its index in the provider's body table.</summary>
        Body,
    }

    /// <summary>
    /// WHAT to propagate, as an identity a provider can resolve, rather than as a
    /// description a provider is obliged to believe.
    ///
    /// <para>A provider handed only <see cref="OrbitElements"/> has been handed a
    /// conic, so whatever it does internally it can only return conics. A target
    /// instead names the object, and carries <see cref="Osculating"/> as the
    /// payload the default two-body provider needs. A provider backed by a
    /// different physics resolves <see cref="Id"/> or <see cref="BodyIndex"/>
    /// against its own model and ignores the elements entirely.</para>
    ///
    /// <para><see cref="Osculating"/> is nullable so that "I have no conic for
    /// this" is expressible. The default two-body provider declines such a
    /// target rather than substituting anything.</para>
    /// <internal>
    /// The default two-body provider is <c>KeplerProvider</c>.
    /// </internal>
    /// </summary>
    /// <category>Propagation and models</category>
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

        /// <summary>Whether this target is a vessel or a body, which decides whether <see cref="Id"/> or <see cref="BodyIndex"/> names it.</summary>
        public PropagationTargetKind Kind { get; }

        /// <summary>The vessel's stable id, or null for a body (which is named by <see cref="BodyIndex"/>).</summary>
        public string? Id { get; }

        /// <summary>Index into the provider's body table for a <see cref="PropagationTargetKind.Body"/> target, or -1 for a vessel.</summary>
        public int BodyIndex { get; }

        /// <summary>
        /// Index of the body this target orbits, or -1 when the caller does not know
        /// it (and, for a body, always, because which body a body orbits is the
        /// provider's to know rather than the caller's to assert). A frame centred on
        /// any other body requires walking the body hierarchy, which is why a provider
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
        /// <param name="id">The vessel's stable id.</param>
        /// <param name="parentBodyIndex">The body it orbits, or -1 when not known.</param>
        /// <param name="osculating">Its elements about that body, or null when the caller has none.</param>
        /// <returns>A <see cref="PropagationTargetKind.Vessel"/> target.</returns>
        public static PropagationTarget Vessel(string id, int parentBodyIndex, OrbitElements? osculating) =>
            new PropagationTarget(PropagationTargetKind.Vessel, id, -1, parentBodyIndex, osculating);

        /// <summary>
        /// A body, NAMED. No elements and no parent: a provider knows where the
        /// bodies are, so a caller's own copy would only be a second opinion the
        /// provider would have to choose between.
        ///
        /// <para>This asymmetry with <see cref="Vessel"/> lets a caller ask where a
        /// body is without holding a conic for it.</para>
        /// </summary>
        /// <param name="bodyIndex">The body's index in the provider's body table.</param>
        /// <returns>A <see cref="PropagationTargetKind.Body"/> target.</returns>
        public static PropagationTarget Body(int bodyIndex) =>
            new PropagationTarget(PropagationTargetKind.Body, null, bodyIndex, -1, null);
    }

    /// <summary>
    /// The frame a result must be expressed in: centred on one body, non-rotating,
    /// in the same Z-up inertial convention the default two-body provider emits.
    ///
    /// <para>Making the frame an argument keeps hierarchy-walking inside a
    /// provider instead of in every caller. A caller that needs a vessel's
    /// position relative to a body other than the one it orbits asks for that
    /// frame directly; how the result is reached (summing conics up and down a
    /// body chain, or reading it out of an n-body integrator) is the provider's
    /// business.</para>
    /// <internal>
    /// The default two-body provider is <c>KeplerProvider</c>.
    /// </internal>
    /// </summary>
    /// <category>Propagation and models</category>
    public readonly struct PropagationFrame
    {
        private PropagationFrame(int centreBodyIndex)
        {
            CentreBodyIndex = centreBodyIndex;
        }

        /// <summary>Index, in the provider's body table, of the body the frame is centred on.</summary>
        public int CentreBodyIndex { get; }

        /// <summary>A non-rotating frame centred on one body.</summary>
        /// <param name="bodyIndex">The centre body's index in the provider's body table.</param>
        /// <returns>The frame.</returns>
        public static PropagationFrame CentredOn(int bodyIndex) => new PropagationFrame(bodyIndex);
    }
}
