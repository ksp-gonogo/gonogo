#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// One planned burn: named delta-v components in a named frame
/// (<see cref="Frame"/>), with the burn's impulsive instant and, when a burn
/// time is modelled, its start and end.
///
/// <para><see cref="Ut"/> is the impulsive instant a stock node has;
/// <see cref="IgnitionUt"/> and <see cref="CutoffUt"/> are the finite burn's
/// start and end. When no burn time is modelled those two are absent, never
/// equal to each other or to <see cref="Ut"/>: an absent duration means "not
/// modelled", while a zero duration with a thrust would mean infinite
/// acceleration.</para>
/// <internal>
/// A burn rather than a stock node because a stock node is an instantaneous
/// impulse and real burns are not, which stock KSP itself concedes by computing
/// DeltaVStageInfo.stageBurnTime and showing a burn-time readout on its navball.
/// </internal>
/// </summary>
/// <category>Orbits and trajectories</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ManeuverNode
{
    /// <summary> Stable, opaque id: the <c>nodeId</c> that
    /// <c>vessel.maneuver.update</c> and <c>vessel.maneuver.remove</c> take. It
    /// round-trips into those commands whether the node was created through
    /// <c>vessel.maneuver.add</c> or placed by hand in the map view. A live
    /// capture always carries one; the empty string appears only on a node
    /// replayed from a recording that carries no ids.
    /// <internal>
    /// Assigned by <c>Gonogo.KSP.KspHost</c> through a shared
    /// <c>ReferenceIdRegistry&lt;global::ManeuverNode&gt;</c> (see that class's
    /// doc comment for the scheme), the same instance <c>KspVesselActuator</c>
    /// uses to resolve the commands' <c>nodeId</c> argument.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Id { get; set; } = "";

    /// <summary>
    /// The instant of the burn's impulsive equivalent: the one instant a
    /// zero-duration model has, in UT seconds. Stock's <c>ManeuverNode.UT</c> is
    /// exactly this.
    ///
    /// <para>It is not the ignition time: a finite burn starts before this and
    /// ends after it. <see cref="IgnitionUt"/> and
    /// <see cref="CutoffUt"/> carry those two instants directly, so there is no
    /// "UT minus half the burn time" convention to guess.</para>
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double Ut { get; set; }

    /// <summary>
    /// When the engines light, in UT seconds, or null when nothing supplies a
    /// burn-duration model for this craft.
    ///
    /// <para>Null is a real reading, not a failure. Stock computes a burn time
    /// only for a loaded vessel, so a queued burn on an unloaded craft has no
    /// ignition time rather than a guessed one.</para>
    ///
    /// <para>Never set equal to <see cref="Ut"/> as a stand-in, so "when to
    /// light the engines is not known" stays distinct from "this burn is
    /// instantaneous".</para>
    /// <internal>
    /// Stock's VesselDeltaV.CheckDirtyAndRun early-returns on !loaded.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? IgnitionUt { get; set; }

    /// <summary>
    /// When the engines cut, in UT seconds, or null on the same terms as
    /// <see cref="IgnitionUt"/>. Burn duration is
    /// <c>CutoffUt - IgnitionUt</c>; there is no separate duration field.
    ///
    /// <para>Not in general <c>Ut</c> plus half the duration: that symmetry
    /// holds only while the craft's mass is constant, and a long burn changes
    /// it.</para>
    /// <internal>
    /// An instant rather than a duration field because a duration beside two
    /// instants is a third number that can disagree with them.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? CutoffUt { get; set; }

    /// <summary>
    /// The basis <see cref="DvRadial"/>/<see cref="DvNormal"/>/
    /// <see cref="DvPrograde"/> are expressed in. Null only on a node replayed
    /// from a recording that does not carry it, on the same terms as
    /// <see cref="Id"/>. Do not read null as the stock basis.
    /// <internal>
    /// Nullable rather than defaulted because
    /// <see cref="ManeuverFrame.RadialNormalPrograde"/> is index 0, so a
    /// defaulted value would assert the stock basis for components that might
    /// be in another one.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public ManeuverFrame? Frame { get; set; }

    /// <summary>
    /// First delta-v component in <see cref="Frame"/>'s basis, in m/s (radial
    /// under the stock basis). Null only if KSP's own dv component was non-finite
    /// (NaN/Infinity) this tick; the node is still sent, never dropped because
    /// one component came back bad.
    /// <internal>
    /// See <c>VesselViewProvider.BuildManeuver</c>.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? DvRadial { get; set; }

    /// <summary>Second delta-v component in <see cref="Frame"/>'s basis
    /// (normal). Null only if KSP's own dv component was non-finite this tick,
    /// as for <see cref="DvRadial"/>.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? DvNormal { get; set; }

    /// <summary>Third delta-v component in <see cref="Frame"/>'s basis
    /// (prograde under the stock basis). Null only if KSP's own dv component
    /// was non-finite this tick, as for <see cref="DvRadial"/>.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? DvPrograde { get; set; }

    /// <summary>Magnitude of the burn's delta-v, in m/s. Null only if KSP's own dv
    /// magnitude was non-finite this tick, as for
    /// <see cref="DvRadial"/>.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? DvTotal { get; set; }

    /// <summary>
    /// This node's post-burn patch chain: element 0 is the orbit the vessel is
    /// on immediately after the burn (KSP's own <c>ManeuverNode.nextPatch</c>),
    /// followed by any later SOI-transition patches, built the same way as
    /// <see cref="VesselOrbit.Patches"/> but starting from the node's own
    /// <c>nextPatch</c>. Always an array, never null: empty when the solver has
    /// not produced a post-burn patch yet (a just-added node mid-tick).
    /// <internal>
    /// The walk is <c>Gonogo.KSP.KspHost.BuildOrbitPatchChain</c>.
    /// </internal>
    ///
    /// <para><b>How one burn links to the next.</b> A burn's input trajectory
    /// is the patch in the previous burn's chain whose
    /// <c>PatchEndTransition</c> is <see cref="TransitionType.Maneuver"/>,
    /// equivalently the one whose <c>EndUt</c> equals this burn's <see
    /// cref="Ut"/>. For the first burn it is the craft's own
    /// <c>vessel.orbit</c>. Every chain is a suffix of the previous one, but
    /// the number of patches skipped varies with how many SOI crossings fall
    /// between the two burns, so counting positions is not the rule and gets it
    /// wrong the first time a crossing appears.</para>
    ///
    /// <para>KSP re-parents strictly sequentially: inserting a
    /// burn ahead of an existing one re-derives every later chain, so a burn's
    /// input is always the previous burn's result.</para>
    ///
    /// <para><b>Patched conics only.</b> A stock plan is a sequence of conics
    /// joined at SOI boundaries. A planner that integrates has no such
    /// boundaries and leaves this empty while still describing a valid burn, so
    /// an empty chain is never a malformed node.</para>
    /// </summary>
    public List<OrbitPatch> Patches { get; set; } = new();
}

/// <summary>
/// The <c>vessel.maneuver</c> Topic payload: the active vessel's planned
/// burns. <see cref="Nodes"/> is always an array, empty when no burn is
/// queued, never null.
/// <internal>
/// <c>KspHost.BuildManeuverNodes</c> returns <c>null</c> for "no nodes
/// queued", the common case; the mapper normalises that to <c>[]</c>.
/// </internal>
///
/// <para><see cref="Nodes"/> is ordered by execution, earliest
/// <see cref="ManeuverNode.Ut"/> first, and that order is the plan: burn N is
/// flown after burn N-1 and acts on what burn N-1 left behind. There is no
/// ordinal or predecessor field; array position says it. The
/// per-burn patch chain expresses the same linkage again, in a form only a
/// patched-conic planner can produce; see
/// <see cref="ManeuverNode.Patches"/>.</para>
/// </summary>
/// <category>Orbits and trajectories</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.maneuver")]
public class VesselManeuver
{
    /// <summary>Every queued burn, earliest <see cref="ManeuverNode.Ut"/>
    /// first. Empty when none is queued, never null. A <see cref="LockedValue"/>
    /// while the Tracking Station does not show patched conics, since a craft
    /// then carries no solver to hold a node.</summary>
    [SitrepRequires("orbit-display", Facility = "TrackingStation", Quantity = "patchedConics")]
    public List<ManeuverNode> Nodes { get; set; } = new();

    /// <summary>
    /// The id of the maneuver-plan provider in use, or null when there is no
    /// planner at all.
    ///
    /// <para>Null is not the same as an empty plan, and stock reaches it on its
    /// own: an un-upgraded Tracking Station leaves the craft with no solver, so
    /// an early-career craft cannot hold a plan at all. Both arrive as
    /// <c>Nodes: []</c>, and this field tells "cannot plan" from "nothing
    /// planned".</para>
    ///
    /// <para>Test only whether it is null. The value is for naming the provider
    /// in a readout or a diagnostic, never for special-casing one.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? Planner { get; set; }

    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c> or <c>"game"</c>).</summary>
    public PayloadMeta Meta { get; set; } = new();
}
