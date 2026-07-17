namespace Gonogo.KerbcastUplink
{
    /// <summary>
    /// The docking facts this uplink DERIVES about one camera's part — the
    /// result shape produced by <see cref="DockingCameraDetector"/>.
    ///
    /// <para>Deliberately in its own KSP-free file: <see cref="DockingCameraDetector"/>
    /// must touch live stock-KSP <c>Part</c>/<c>ModuleDockingNode</c> types and so
    /// cannot compile headless, but this result shape (and every consumer of it,
    /// like <see cref="KerbcastCameraEntryBuilder"/>) is pure data and IS tested
    /// headless. Same selective-Compile split the sibling Uplink test
    /// projects use.</para>
    ///
    /// <para>All-null (<c>default</c>) is the "could not determine" reading —
    /// an unreadable part — deliberately distinct from
    /// <c>IsDockingCamera = false</c>, which means "read the part, it has no
    /// docking node". R7 typed absence: the wire must be able to say "I don't
    /// know" without lying "it isn't one".</para>
    /// </summary>
    public struct DockingCameraFacts
    {
        /// <summary>True when the camera's own part carries a <c>ModuleDockingNode</c>; null when undeterminable.</summary>
        public bool? IsDockingCamera;

        /// <summary>The docking node's <c>nodeType</c> (e.g. <c>size1</c>), or null.</summary>
        public string? NodeType;

        /// <summary>The docking node's live <c>state</c> (e.g. <c>Ready</c>, <c>Docked</c>), or null.</summary>
        public string? State;
    }
}
