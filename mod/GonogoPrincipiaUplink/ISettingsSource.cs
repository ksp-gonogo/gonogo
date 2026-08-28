namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Resolves a celestial's index to its name.
    ///
    /// <para>The producer identifies the bodies in a frame by their game index,
    /// not by name, so a burn's manœuvring frame arrives as three integers. Naming
    /// them needs the game's body table, which is the one thing in this reading
    /// that cannot be done headless, so it is a seam rather than a call.</para>
    /// </summary>
    public interface ICelestialNames
    {
        /// <summary>The body's name, or null when the index names none. Minus one
        /// is the producer's own "no body" and is not an error.</summary>
        string? NameOf(int index);

        /// <summary>
        /// The body's radius in metres, or null when the index names none.
        ///
        /// <para>Needed because the producer's orbit analysis reports apsis
        /// DISTANCES from the primary's centre, while every apsis an operator reads
        /// is an ALTITUDE. The offset is the radius, the producer applies it in its
        /// own formatter, and a distance published under an altitude's name is
        /// wrong by a planet.</para>
        /// </summary>
        double? RadiusOf(int index);

        /// <summary>
        /// Every body index this game has, in the order the game holds them.
        ///
        /// <para>A write that names a body needs this and <see cref="NameOf"/>
        /// cannot supply it: asking "is 7 a body" one index at a time cannot tell
        /// an index the game does not have from a table that has not loaded, and
        /// the two want opposite answers. Empty means not read.</para>
        /// </summary>
        System.Collections.Generic.IReadOnlyList<int> Indices { get; }
    }

    /// <summary>
    /// Where the settings reading gets everything it cannot compute.
    ///
    /// <para>A seam for the same reason <see cref="IFlightPlanObserver"/> is one:
    /// finding the producer's addon, binding its plugin and enumerating the game's
    /// bodies all need the game, and the decisions made around them should not.
    /// Everything behind this interface is a lookup; every judgement about what to
    /// publish stays where a test can drive it.</para>
    /// </summary>
    public interface ISettingsSource
    {
        /// <summary>Starts observing, if the producer is there to observe.
        /// Idempotent, and false rather than throwing when it cannot.</summary>
        bool TryAttach();

        /// <summary>The producer's main window, or null.</summary>
        object? MainWindow { get; }

        /// <summary>The producer's plotting-frame selector, or null.</summary>
        object? FrameSelector { get; }

        /// <summary>The producer's flight planner, or null.</summary>
        object? FlightPlanner { get; }

        /// <summary>The producer's orbit analyser, or null.</summary>
        object? OrbitAnalyser { get; }

        /// <summary>The bound, version-gated session, or null when the version gate
        /// refused or no plugin is running. Everything read through the plugin is
        /// absent in that case, and the managed half still reads.</summary>
        PrincipiaSession? Session { get; }

        /// <summary>The vessel the per-vessel integrator bounds should be read for,
        /// as a guid, or null when there is none. Unproved: the session's own
        /// predicate is what decides whether it may be used.</summary>
        string? ActiveVesselGuid { get; }

        /// <summary>The targeted celestial's name, when the game's target is a body
        /// rather than a vessel. It has no home on the producer's own windows: body
        /// targeting is the game's mechanism and the producer only arms the picker,
        /// so this comes from the game directly.</summary>
        string? TargetCelestialBody { get; }

        /// <summary>The game's body table.</summary>
        ICelestialNames Celestials { get; }

        /// <summary>
        /// What the craft currently weighs, in tonnes, or null when the game has no
        /// such craft.
        ///
        /// <para>Read here rather than stated by whoever is planning, because it is
        /// a fact about the craft and the craft is where it is true. A command
        /// centre's figure for it is a light-time old by the time a plan lands, and
        /// a plan built on a mass the craft no longer has is a plan the craft cannot
        /// fly.</para>
        /// </summary>
        double? MassTonsOf(string vesselGuid);
    }
}
