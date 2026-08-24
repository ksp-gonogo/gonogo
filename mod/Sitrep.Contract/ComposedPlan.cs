#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract
{
    /// <summary>
    /// One burn as a command centre SPECIFIED it, which is a different thing from
    /// one as the craft reports it.
    ///
    /// <para><b>Inputs only.</b> A <see cref="ManeuverNode"/> carries what a burn
    /// turned out to be: its cutoff, its final mass, the patch chain it puts the
    /// craft on. None of those is something an operator states, they are what a
    /// planner works out, and putting them in a command would invite a caller to
    /// state a conclusion and have it quietly ignored.</para>
    ///
    /// <para><b>Anchored to ignition.</b> A burn starts when it starts. The
    /// half-delta-v instant a node reports is derived from a solved burn, so it
    /// cannot be the thing that specifies one.</para>
    /// </summary>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public class ComposedBurn
    {
        [SitrepUnit(Units.UniversalTime)]
        public double IgnitionUt { get; set; }

        /// <summary>
        /// The basis the three components below are in.
        ///
        /// <para>Stated rather than assumed, because the same three numbers are a
        /// different burn in each basis and both bases are in use: stock plans in
        /// radial/normal/prograde, an integrating planner in the Frenet trihedron.
        /// A default here would silently reinterpret every burn sent by the other
        /// one.</para>
        /// </summary>
        [SitrepUnit(Units.Enumeration)]
        public ManeuverFrame Frame { get; set; }

        /// <summary>
        /// The basis's first, second and third component, in the basis's own
        /// order, exactly as <see cref="ManeuverNode.Frame"/> describes for the
        /// reported shape. So these are radial/normal/prograde under
        /// <see cref="ManeuverFrame.RadialNormalPrograde"/> and
        /// tangent/normal/binormal under
        /// <see cref="ManeuverFrame.TangentNormalBinormal"/>.
        /// </summary>
        [SitrepUnit(Units.MetresPerSecond)]
        public double DvRadial { get; set; }

        [SitrepUnit(Units.MetresPerSecond)]
        public double DvNormal { get; set; }

        [SitrepUnit(Units.MetresPerSecond)]
        public double DvPrograde { get; set; }

        /// <summary>
        /// Hold the burn's direction against the stars rather than against the
        /// craft's moving frame.
        /// </summary>
        [SitrepUnit(Units.Flag)]
        public bool InertiallyFixed { get; set; }

        /// <summary>
        /// The engine to burn with. BOTH absent means "leave whatever the plan
        /// already holds", which is the ordinary case for editing an existing
        /// burn.
        ///
        /// <para>Stated as real numbers rather than as a named preset. A preset is
        /// one planner's idea of a placeholder engine, and core naming it would
        /// put that planner's numbers in every other planner's contract; a caller
        /// that wants a placeholder states the placeholder.</para>
        /// </summary>
        [SitrepUnit(Units.Kilonewtons)]
        public double? Thrust { get; set; }

        [SitrepUnit(Units.Seconds)]
        public double? SpecificImpulse { get; set; }
    }

    /// <summary>
    /// A whole flight plan, composed at a command centre and transmitted to be
    /// instantiated aboard.
    ///
    /// <para><b>Why a whole plan rather than per-burn edits.</b> Five burn edits
    /// are five messages, each with its own light-time, each able to arrive late,
    /// out of order, or not at all. A craft that received three of them would fly
    /// a plan nobody composed and nobody approved. One plan is one message,
    /// applied whole or not at all.</para>
    ///
    /// <para><b>The burns are transmitted, never re-derived.</b> The receiving
    /// side installs these numbers rather than re-solving toward a goal. A plan
    /// re-solved on arrival would be solved against the craft's true state, which
    /// is ahead of everything the operator could see, so the craft would fly
    /// something nobody at the command centre ever looked at.</para>
    /// </summary>
    [SitrepContract]
#if SITREP_CODEGEN
    [TsInterface]
#endif
    public class SendManeuverPlanArgs
    {
        [SitrepUnit(Units.Id)]
        public string? VesselId { get; set; }

        /// <summary>
        /// Stable per-intent id, so a plan that is retransmitted after a silence
        /// is recognised as the same plan rather than applied twice.
        /// </summary>
        [SitrepUnit(Units.Id)]
        public string? RequestId { get; set; }

        /// <summary>
        /// The view instant the plan was composed against: what the command centre
        /// could see when it decided.
        /// </summary>
        [SitrepUnit(Units.UniversalTime)]
        public double? ComposedAtViewUt { get; set; }

        /// <summary>
        /// The instant the state used for planning was actually TRUE, at or before
        /// <see cref="ComposedAtViewUt"/>.
        ///
        /// <para>Both travel because they answer different questions: one is when
        /// the operator decided, the other is how old their information already
        /// was. Together they make the divergence between what was planned against
        /// and what received the plan a measurement rather than a guess.</para>
        /// </summary>
        [SitrepUnit(Units.UniversalTime)]
        public double? ObservedAtUt { get; set; }

        /// <summary>
        /// The burns, in order. An EMPTY list is a plan with no burns, which is a
        /// meaningful thing to send because it clears the plan; a NULL list is a
        /// malformed command and is refused. The two must not be confused.
        /// </summary>
        public ComposedBurn[]? Burns { get; set; }

        /// <summary>How far the plan is asked to run.</summary>
        [SitrepUnit(Units.UniversalTime)]
        public double? DesiredFinalTimeUt { get; set; }

        /// <summary>
        /// The vessel mass the plan's FIRST burn is planned against.
        ///
        /// <para>Needed only where the craft has no plan yet, and only for the
        /// first burn: every burn after it is planned against the mass the planner
        /// computed for the one ahead of it. A planner that already has a plan
        /// aboard ignores this and uses its own figure, which is the better
        /// one.</para>
        /// </summary>
        [SitrepUnit(Units.Tonnes)]
        public double? MassTons { get; set; }
    }
}
