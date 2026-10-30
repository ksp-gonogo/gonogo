namespace Sitrep.Contract
{
    /// <summary>
    /// The <c>lensSites</c> capability: which command centre a camera lens
    /// stands at, and how far a commanding centre's knowledge has reached the
    /// lenses that share one scope. Resolve it through
    /// <see cref="IUplinkHost.Kernel"/> as an <see cref="ILensSites"/>. Useful
    /// for a camera Uplink that hands another mod what a lens's site may know,
    /// so the camera frames only what the light and signals that reached it
    /// carry. Gonogo registers the only provider.
    /// </summary>
    /// <category>Host and Kernel</category>
    public static class LensSitesCapability
    {
        /// <summary>The capability id, <c>"lensSites"</c>.</summary>
        public const string Id = "lensSites";
    }

    /// <summary>
    /// Places camera lenses at command centres and reports, per scope, the
    /// newest instant of the commanding centre's knowledge that has reached
    /// every lens in it. A site is a centre id as <c>commandCentre.roster</c>
    /// lists it: <c>"ground:&lt;name&gt;"</c> for a lens at a ground station,
    /// or <c>"vessel:&lt;guid&gt;"</c> for a lens on a craft.
    ///
    /// <para><see cref="GroundStationNamed"/> reads live game state and is main
    /// thread only. <see cref="Bind"/>, <see cref="Unbind"/> and
    /// <see cref="KnowledgeUt"/> are safe on any thread.</para>
    /// </summary>
    /// <category>Host and Kernel</category>
    public interface ILensSites : ISitrepProvider
    {
        /// <summary>
        /// The roster id of the active ground station whose network node is
        /// named <paramref name="nodeName"/>, as the comms provider names its home
        /// node: the name another mod, such as a camera mod, uses for the same
        /// station. Match a station through this rather than on the text after
        /// <c>"ground:"</c> in a roster id, which carries a <c>#2</c> suffix when two
        /// stations share a name. Null when no active ground station has that
        /// name, and when more than one has, so a lens is never placed at the
        /// wrong one of two stations that share a name. Main thread only.
        /// </summary>
        /// <param name="nodeName">The station's network node name, as the comms provider names its home node.</param>
        string? GroundStationNamed(string nodeName);

        /// <summary>
        /// The roster id of the active ground station nearest the surface point at
        /// <paramref name="latitude"/> and <paramref name="longitude"/> on the body
        /// <paramref name="bodyIndex"/>, as <c>bodies</c> numbers it: the station that
        /// runs a launch site or other surface site that is not itself a network node.
        /// Distance is along the surface. Null when no active ground station stands on
        /// that body, and when two stations are equally near, so a lens is never placed
        /// at a guess between them. Main thread only.
        /// </summary>
        /// <param name="bodyIndex">The body the site is on.</param>
        /// <param name="latitude">The site's body-fixed latitude in degrees.</param>
        /// <param name="longitude">The site's body-fixed longitude in degrees.</param>
        string? GroundStationNear(int bodyIndex, double latitude, double longitude);

        /// <summary>
        /// Starts delivering <paramref name="commandingCentre"/>'s knowledge to
        /// the lens at <paramref name="site"/>, counted into
        /// <paramref name="scope"/>. Lenses bound to one scope are aged by the
        /// longest delay among them. Binding a site again in the same scope
        /// replaces its commanding centre. A centre commanding a lens at its
        /// own site reaches it at once.
        /// </summary>
        /// <param name="scope">The caller's own name for a group of lenses that know the same things.</param>
        /// <param name="site">Where the lens stands, as a roster centre id.</param>
        /// <param name="commandingCentre">The roster id of the centre whose knowledge the lens receives.</param>
        void Bind(string scope, string site, string commandingCentre);

        /// <summary>Stops counting <paramref name="site"/> toward <paramref name="scope"/>. Unknown pairs are ignored.</summary>
        void Unbind(string scope, string site);

        /// <summary>
        /// The newest universal time of its commanding centre's knowledge that
        /// has reached every lens in <paramref name="scope"/>, or null while
        /// none has, or when nothing is bound to it. Never moves back, and
        /// holds still while the path to any of its lenses is lost or has no
        /// measured delay: a lens whose link drops keeps what it knew and learns
        /// nothing new. A path is known
        /// only from the first tick that saw it, so after a bind and after a
        /// return this holds for one more delay, then reads the centre's
        /// knowledge as of that tick; nothing sent before it ever counts as
        /// reached.
        /// </summary>
        double? KnowledgeUt(string scope);
    }
}
