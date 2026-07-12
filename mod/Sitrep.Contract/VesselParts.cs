using System.Collections.Generic;
#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.parts</c> channel payload — the active vessel's full
/// part-tree topology (P1b slice 2), the foundation ShipMap / PowerSystems
/// topology / ThermalStatus all build on. A SINGLE WRAPPER OBJECT (or
/// <c>null</c> when there is no active vessel / no topology group this tick),
/// so the Topic tag sits on this type directly with the default
/// <c>IsArray = false</c> — same posture as <see cref="VesselStructure"/> and
/// the sibling structured <c>vessel.*</c> channels, NOT the bare-array
/// <c>parts.robotics</c>.
///
/// <para><b>Thermal folds in here.</b> Per-part temperatures ride each
/// <see cref="VesselPart"/> (<see cref="VesselPart.CurrentTemp"/>/
/// <see cref="VesselPart.MaxTemp"/>/<see cref="VesselPart.SkinTemp"/>/
/// <see cref="VesselPart.SkinMaxTemp"/>), so the hottest-part / engine /
/// heat-shield rollups are SDK-DERIVABLE on top of this channel — there is no
/// separate <c>therm.hottestPart*</c> Topic (v-topology-redesign.md). The
/// existing <c>vessel.thermal</c> rollup channel is NOT removed by this build;
/// that is a later cleanup.</para>
///
/// <para><b>Typing-only mirror.</b> This reproduces, field-for-field, the
/// exact serialized shape <c>Sitrep.Host.VesselPartsViewProvider.ToWire</c>
/// already emits (same names, same camelCase wire keys via
/// <c>RtConfig.CamelCaseForProperties</c>, same units). It is NOT serialized
/// itself — the wire is written by <c>JsonWriter</c> walking the provider's
/// dictionary — so adding it changes no bytes.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
[SitrepTopic("vessel.parts")]
public class VesselParts
{
    /// <summary>Every part on the active vessel this tick, in vessel part-list order. Always present (possibly empty); a vessel-less tick yields a <c>null</c> payload, not an empty list.</summary>
    public List<VesselPart> Parts { get; set; } = new();

    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// One part in the <see cref="VesselParts.Parts"/> tree. Provenance-scoped
/// like <see cref="VesselStructure"/> (whole payload absent when there is no
/// vessel), so the always-present required fields (<see cref="Id"/>/
/// <see cref="Name"/>/<see cref="Position"/>/<see cref="DryMass"/>/
/// <see cref="InverseStage"/>/<see cref="MaxTemp"/>) are non-nullable, while
/// the genuinely-optional ones (<see cref="ParentId"/> null for the root,
/// <see cref="Up"/>, <see cref="SkinMaxTemp"/>/<see cref="CurrentTemp"/>/
/// <see cref="SkinTemp"/> unset before physics runs,
/// <see cref="FuelLineTargetId"/>) are nullable.
///
/// <para><b>Join key.</b> <see cref="Id"/> is <c>Part.flightID</c> stringified
/// — the SAME string form <c>parts.power</c>/<c>parts.robotics</c>'s
/// <c>partId</c> uses, so a consumer (RoboticsConsole, PowerSystems) can
/// id-join a part across those channels. <see cref="ParentId"/> and
/// <see cref="FuelLineTargetId"/> are the same string form for the same
/// reason. flightID's stability across a docking/undocking round-trip is a
/// KSP-side caveat carried forward from the design's open questions.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class VesselPart
{
    /// <summary><c>Part.flightID</c> stringified — the tree/cross-channel join key. Empty string only for the uninitialized-0 sentinel (no live flight id yet).</summary>
    public string Id { get; set; } = "";

    /// <summary><c>Part.parent?.flightID</c> stringified; <c>null</c> for the root part.</summary>
    public string? ParentId { get; set; }

    /// <summary><c>Part.partInfo.name</c> (the <c>AvailablePart.name</c> config id, e.g. <c>"solarPanels1"</c>).</summary>
    public string Name { get; set; } = "";

    /// <summary><c>Part.partInfo.title</c> (the display title, e.g. <c>"OX-STAT Photovoltaic Panels"</c>).</summary>
    public string Title { get; set; } = "";

    /// <summary><c>Part.orgPos</c> — the part's original vessel-local position (metres, vessel frame).</summary>
    public Vec3 Position { get; set; } = new();

    /// <summary>The part's local up axis (<c>Part.orgRot * Vector3.up</c>), for orienting flow/thrust glyphs. <c>null</c> on a snapshot recorded before this field existed.</summary>
    public Vec3? Up { get; set; }

    public PartBounds Bounds { get; set; } = new();

    /// <summary><c>Part.mass</c> — dry mass (tonnes).</summary>
    public double DryMass { get; set; }

    /// <summary><c>Part.inverseStage</c> (KSP's own inverted staging numbering, carried forward unchanged — see <see cref="VesselStructure.CurrentStage"/>).</summary>
    public int InverseStage { get; set; }

    /// <summary><c>Part.maxTemp</c> — internal max temperature (K).</summary>
    public double MaxTemp { get; set; }

    /// <summary><c>Part.skinMaxTemp</c> (K); <c>null</c> for the <c>-1</c> "no skin-thermal model" sentinel.</summary>
    public double? SkinMaxTemp { get; set; }

    /// <summary><c>Part.temperature</c> — current internal temperature (K); <c>null</c> for the <c>-1</c> "not yet simulated" sentinel.</summary>
    public double? CurrentTemp { get; set; }

    /// <summary><c>Part.skinTemperature</c> — current skin temperature (K).</summary>
    public double? SkinTemp { get; set; }

    /// <summary><c>Part.partInfo.category</c> (<c>PartCategories</c> enum name, e.g. <c>"Engine"</c>).</summary>
    public string Category { get; set; } = "";

    /// <summary>Each <c>PartModule</c>'s CLR class name (e.g. <c>"ModuleEngines"</c>, <c>"CModuleFuelLine"</c>) — what ShipMap's <c>classifyPart</c> matches on.</summary>
    public List<string> Modules { get; set; } = new();

    /// <summary><c>Part.isRobotic()</c> — a Breaking Ground robotic servo part.</summary>
    public bool IsRobotics { get; set; }

    /// <summary>True when the part carries a solar panel, alternator, EC-producing converter, or an ElectricCharge resource capacity.</summary>
    public bool IsPowerRelated { get; set; }

    /// <summary>For a fuel-line part, the stringified <c>flightID</c> of the part it feeds; <c>null</c> otherwise.</summary>
    public string? FuelLineTargetId { get; set; }

    /// <summary>
    /// Every resource this part carries (join key: resource name, e.g.
    /// <c>"ElectricCharge"</c>), storage plus live production/consumption
    /// flow — the per-part live-data slice the SDK's <c>usePartsLive</c>
    /// used to fetch off the legacy <c>r.resourceFor[flightId]</c> key.
    /// Empty dict when the part carries no resources.
    /// </summary>
    public Dictionary<string, PartResourceFlow> Resources { get; set; } = new();

    /// <summary>
    /// Per-module behavioural state (solar deployed, engine firing,
    /// parachute armed, etc.) — one entry per module on the part that maps
    /// to <see cref="PartModuleState"/>'s vocabulary, in <c>Part.Modules</c>
    /// order. The per-part live-data slice the SDK used to fetch off the
    /// legacy <c>v.partState[flightId]</c> key. Empty list when the part
    /// carries no module of a mapped type.
    /// </summary>
    public List<PartModuleState> ModuleStates { get; set; } = new();
}

/// <summary>
/// One resource row in <see cref="VesselPart.Resources"/> — storage
/// (<see cref="Amount"/>/<see cref="MaxAmount"/>) plus live flow
/// (<see cref="Flow"/>/<see cref="NominalFlow"/>). Mirrors the SDK's
/// <c>PartResources</c> row shape field-for-field.
///
/// <para><b>Flow scope.</b> <see cref="Flow"/>/<see cref="NominalFlow"/>
/// are populated only for the module types whose live rate is CHEAPLY
/// derivable from public fields without hand-simulating KSP's resource
/// solver — solar panels (<c>ModuleDeployableSolarPanel.flowRate</c>/
/// <c>chargeRate</c>), alternators (<c>ModuleAlternator.outputRate</c>),
/// and engine propellant consumption (<c>Propellant.currentRequirement</c>,
/// signed negative). This is the SAME "if cheap" scoping
/// <c>KspHost.BuildPartsPower</c>'s doc comment already establishes for
/// <c>totalProductionEc</c> — resource converters / fuel cells / drills
/// report storage only (no computed rate; not cheaply derivable from
/// static fields), matching that precedent rather than inventing a shaky
/// approximation. <see cref="NominalFlow"/> is omitted (left <c>null</c>)
/// whenever it would equal <see cref="Flow"/>, per the SDK contract.</para>
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class PartResourceFlow
{
    /// <summary><c>PartResource.amount</c> — current stored amount.</summary>
    public double Amount { get; set; }

    /// <summary><c>PartResource.maxAmount</c> — storage capacity.</summary>
    public double MaxAmount { get; set; }

    /// <summary>Signed units/sec — positive = producing, negative = consuming. <c>null</c> when no cheaply-derivable module contributes.</summary>
    public double? Flow { get; set; }

    /// <summary>Same-sign 100%-efficiency cap (rated solar output). <c>null</c> when no module supports a nominal, or when it would equal <see cref="Flow"/>.</summary>
    public double? NominalFlow { get; set; }
}

/// <summary>
/// One module's behavioural state in <see cref="VesselPart.ModuleStates"/>.
/// Mirrors the SDK's <c>PartStateModule</c> shape field-for-field — see that
/// interface's doc comment for the full state vocabulary per <see cref="Type"/>.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class PartModuleState
{
    /// <summary>Discriminator: <c>solarPanel</c> / <c>radiator</c> / <c>antenna</c> / <c>parachute</c> / <c>engine</c> / <c>drill</c> / <c>landingGear</c>. (<c>cargoBay</c> is a defined vocabulary value with no module here — see <c>KspHost.BuildPartModuleStates</c>'s doc comment for why.)</summary>
    public string Type { get; set; } = "";

    /// <summary>The standardised deploy/activation state — see <c>PartStateModule</c>'s doc comment for the per-type vocabulary.</summary>
    public string State { get; set; } = "";

    /// <summary>Solar-panel-only: sun-tracking gimbal active. <c>null</c> for every other type.</summary>
    public bool? Tracking { get; set; }

    /// <summary>Engine-only: fuel-starved. <c>null</c> unless <c>true</c> (never emitted as a bare <c>false</c>).</summary>
    public bool? Flameout { get; set; }
}

/// <summary>
/// A <see cref="VesselPart"/>'s local bounding box — <see cref="Size"/> is the
/// part's <c>prefabSize</c> (a cheap, per-part-constant proxy for the renderer
/// bounds ShipMap could refine later), <see cref="Center"/> the mesh-centre
/// offset from <see cref="VesselPart.Position"/> (<c>Part.boundsCentroidOffset</c>,
/// vessel-local). Fuel-line parts report a whole-conduit-wrapping bounds — a
/// carried-forward KSP quirk the consumer handles, not this capture.
/// </summary>
[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class PartBounds
{
    /// <summary><c>Part.prefabSize</c> — the part's untransformed bounding-box extents (metres).</summary>
    public Vec3 Size { get; set; } = new();

    /// <summary><c>Part.boundsCentroidOffset</c> — mesh-centre offset from <see cref="VesselPart.Position"/> (metres, vessel-local); <c>null</c> when absent.</summary>
    public Vec3? Center { get; set; }
}
