#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;

namespace Sitrep.Contract;

/// <summary>
/// One planned BURN. NAMED delta-v components in a NAMED frame
/// (<see cref="Frame"/>), with the impulsive case as the one where
/// <see cref="IgnitionUt"/> and <see cref="CutoffUt"/> are absent rather than
/// equal.
///
/// <para><b>A burn, not a stock node.</b> A stock node is an instantaneous
/// impulse and real burns are not, which stock KSP itself concedes by computing
/// <c>DeltaVStageInfo.stageBurnTime</c> and by carrying a burn-time readout on
/// its own navball. <see cref="Ut"/>, <see cref="IgnitionUt"/> and
/// <see cref="CutoffUt"/> carry the impulsive instant and the finite burn's
/// start and end.</para>
///
/// <para><b>The impulsive case is absent duration, never zero duration.</b> A
/// zero-duration burn with a thrust implies infinite acceleration, so any
/// consumer computing thrust times duration over mass gets nonsense instead of
/// an impulse. Absence says "not modelled", which is the true statement.</para>
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
    /// The instant the burn's IMPULSIVE EQUIVALENT occurs: the one instant a
    /// zero-duration model has. Stock's <c>ManeuverNode.UT</c> is exactly this.
    ///
    /// <para><b>It is not the ignition time.</b> A finite burn starts before
    /// this and ends after it. <see cref="IgnitionUt"/> and
    /// <see cref="CutoffUt"/> carry those two instants directly, so there is no
    /// "UT minus half the burn time" convention to guess.</para>
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double Ut { get; set; }

    /// <summary>
    /// When the engines light, or null when nothing supplies a burn-duration
    /// model for this craft.
    ///
    /// <para>Null is a real reading and not a failure, on the same terms as
    /// <c>IPropagationProvider.CharacteristicCycleSeconds</c>. Stock computes a
    /// burn time only for a LOADED vessel
    /// (<c>VesselDeltaV.CheckDirtyAndRun</c> early-returns on
    /// <c>!loaded</c>), so an unloaded craft's queued burn honestly has no
    /// ignition time rather than a guessed one.</para>
    ///
    /// <para><b>Never a sentinel equal to <see cref="Ut"/>.</b> Collapsing an
    /// unmodelled duration onto the impulsive instant would make "we do not
    /// know when to light the engines" indistinguishable from "this burn is
    /// instantaneous", and only one of those is ever true.</para>
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? IgnitionUt { get; set; }

    /// <summary>
    /// When the engines cut, or null on the same terms as
    /// <see cref="IgnitionUt"/>. Burn duration is
    /// <c>CutoffUt - IgnitionUt</c>.
    ///
    /// <para>Carried as an instant rather than as a separate duration field on
    /// purpose: a duration alongside two instants is a third number that can
    /// disagree with the other two, and there is no reading of a disagreement
    /// that helps anybody.</para>
    ///
    /// <para>Not derivable as <c>Ut</c> plus half a duration in general. That
    /// symmetry holds only while the craft's mass is constant, and a burn long
    /// enough to be worth modelling is long enough to change it.</para>
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
    /// First delta-v component in <see cref="Frame"/>'s basis (radial under
    /// the stock basis). Null only if KSP's own dv component was non-finite
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

    /// <summary>Magnitude of the burn's delta-v. Null only if KSP's own dv
    /// magnitude was non-finite this tick, as for
    /// <see cref="DvRadial"/>.</summary>
    [SitrepUnit(Units.MetresPerSecond)]
    public double? DvTotal { get; set; }

    /// <summary>
    /// This node's post-burn future-orbit patch chain: element 0 is the
    /// orbit the vessel is on IMMEDIATELY after the burn (KSP's own
    /// <c>ManeuverNode.nextPatch</c>), followed by any subsequent
    /// SOI-transition patches, built the same way as
    /// <see cref="VesselOrbit.Patches"/> but starting from the node's own
    /// <c>nextPatch</c>. ALWAYS an array, never null: empty when the solver has
    /// not produced a post-burn patch yet (a just-added node mid-tick).
    /// <internal>
    /// The walk is <c>Gonogo.KSP.KspHost.BuildOrbitPatchChain</c>.
    /// </internal>
    ///
    /// <para><b>How one burn links to the next.</b> A burn's INPUT trajectory
    /// is the patch in the PREVIOUS burn's chain whose
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
    /// <para><b>This whole field is a PATCHED-CONIC encoding.</b> It exists
    /// because a stock plan IS a sequence of conics joined at SOI boundaries. A
    /// planner that integrates has no such boundaries and will leave this empty
    /// while still describing a perfectly good burn, so nothing may treat an
    /// empty chain as a malformed node.</para>
    /// </summary>
    public List<OrbitPatch> Patches { get; set; } = new();
}

/// <summary>
/// The <c>vessel.maneuver</c> channel payload: the active vessel's planned
/// burns. <see cref="Nodes"/> is ALWAYS an array, empty when no burn is
/// queued, never null.
/// <internal>
/// <c>KspHost.BuildManeuverNodes</c> returns <c>null</c> for "no nodes
/// queued", the common case; the mapper normalises that to <c>[]</c>.
/// </internal>
///
/// <para><b><see cref="Nodes"/> is ordered by execution</b>, earliest
/// <see cref="ManeuverNode.Ut"/> first, and that ordering IS the plan: burn N
/// is flown after burn N-1 and acts on what burn N-1 left behind. No separate
/// ordinal or predecessor field is carried: array position says it. The
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
    /// first. Empty when none is queued, never null.</summary>
    public List<ManeuverNode> Nodes { get; set; } = new();

    /// <summary>
    /// The elected maneuver-plan provider's id, or null when THERE IS NO
    /// PLANNER AT ALL.
    ///
    /// <para>That is not the same fact as an empty plan, and stock reaches it
    /// on its own: an un-upgraded Tracking Station leaves
    /// <c>Vessel.patchedConicSolver</c> null, so an early-career craft cannot
    /// hold a plan rather than merely not holding one. Without this field both
    /// arrive as <c>Nodes: []</c> and an operator is told their plan is empty
    /// when the truth is that they cannot make one.</para>
    ///
    /// <para>Nothing outside the election may branch on the VALUE: a provider
    /// says what it is so a readout can name it and a diagnostic can record it,
    /// never so a consumer can special-case one. Present-versus-null is the
    /// only part anything should test.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? Planner { get; set; }

    /// <summary>The payload's provenance (<c>"vessel:&lt;guid&gt;"</c> or <c>"game"</c>) and quality.</summary>
    public PayloadMeta Meta { get; set; } = new();
}
