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
    /// What to propagate: the object itself, named so a provider can resolve it
    /// against its own model.
    ///
    /// <para>A target names the object and carries <see cref="Osculating"/>, the
    /// elements the default two-body provider needs. A provider backed by
    /// different physics resolves <see cref="Id"/> or <see cref="BodyIndex"/>
    /// against its own model and may ignore the elements entirely.</para>
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
        /// it. Always -1 for a body, whose parent is the provider's to know. A frame
        /// centred on any other body needs the provider to walk the body hierarchy,
        /// so ask
        /// <see cref="IPropagationProvider.CanPropagate(PropagationTarget, PropagationFrame, double, double)"/>
        /// first.
        /// </summary>
        public int ParentBodyIndex { get; }

        /// <summary>
        /// The target's elements about <see cref="ParentBodyIndex"/> at their own
        /// epoch. Null when the caller has none, which is not an error.
        /// </summary>
        public OrbitElements? Osculating { get; }

        /// <summary>
        /// A vessel target, with its elements. A vessel carries them because a
        /// provider has no registry of vessels to look an id up in: the caller is
        /// the one holding a sample of the craft. Compare <see cref="Body"/>.
        /// </summary>
        /// <param name="id">The vessel's stable id.</param>
        /// <param name="parentBodyIndex">The body it orbits, or -1 when not known.</param>
        /// <param name="osculating">Its elements about that body, or null when the caller has none.</param>
        /// <returns>A <see cref="PropagationTargetKind.Vessel"/> target.</returns>
        public static PropagationTarget Vessel(string id, int parentBodyIndex, OrbitElements? osculating) =>
            new PropagationTarget(PropagationTargetKind.Vessel, id, -1, parentBodyIndex, osculating);

        /// <summary>
        /// A body target, by index alone. It carries no elements and no parent,
        /// because a provider knows where the bodies are, so a caller can ask where
        /// a body is without holding a conic for it.
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
    /// <para>A caller that needs a vessel's position relative to a body other than
    /// the one it orbits asks for that frame directly. How the result is reached
    /// (summing conics up and down a body chain, or reading it out of an n-body
    /// integrator) is up to the provider.</para>
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
