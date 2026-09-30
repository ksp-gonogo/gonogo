using System.Collections.Generic;
#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// The <c>vessel.parts</c> channel payload: the active vessel's full part
/// tree, with each part's position, mass, temperatures, resources, module
/// states and action-group bindings. A single object, or <c>null</c> when
/// there is no active vessel.
///
/// <para>Per-part temperatures ride each <see cref="VesselPart"/>
/// (<see cref="VesselPart.CurrentTemp"/>, <see cref="VesselPart.MaxTemp"/>,
/// <see cref="VesselPart.SkinTemp"/>, <see cref="VesselPart.SkinMaxTemp"/>),
/// so a hottest-part, engine or heat-shield rollup can be derived from this
/// channel. <c>vessel.thermal</c> carries a ready-made hottest-part
/// rollup.</para>
/// <internal>
/// Typing-only mirror of Sitrep.Host.VesselPartsViewProvider.ToWire's shape
/// (camelCase keys via RtConfig.CamelCaseForProperties); the wire is written
/// by JsonWriter walking the provider's dictionary.
/// </internal>
/// </summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
[SitrepTopic("vessel.parts")]
public class VesselParts
{
    /// <summary>Every part on the active vessel this tick, in vessel part-list
    /// order. Always present (possibly empty); a tick with no vessel yields a
    /// <c>null</c> payload, not an empty list.</summary>
    public List<VesselPart> Parts { get; set; } = new();

    /// <summary>The payload's provenance, always <c>"vessel:&lt;guid&gt;"</c> for the active vessel.</summary>
    public PayloadMeta Meta { get; set; } = new();
}

/// <summary>
/// One part in the <see cref="VesselParts.Parts"/> tree. <see cref="Id"/>,
/// <see cref="Name"/>, <see cref="Position"/>, <see cref="DryMass"/>,
/// <see cref="InverseStage"/> and <see cref="MaxTemp"/> are always present;
/// <see cref="ParentId"/> (null for the root), <see cref="Up"/>, the current
/// and skin temperatures (unset before physics runs) and
/// <see cref="FuelLineTargetId"/> are nullable.
///
/// <para><b>Join key.</b> <see cref="Id"/> is <c>Part.flightID</c> as a
/// string, the same form the <c>partId</c> of <c>parts.power</c> and
/// <c>parts.robotics</c> uses, so a part can be joined across those channels.
/// <see cref="ParentId"/> and <see cref="FuelLineTargetId"/> use the same
/// form. Whether a flightID survives docking and undocking is up to
/// KSP.</para>
/// </summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class VesselPart
{
    /// <summary><c>Part.flightID</c> as a string: the join key within the tree
    /// and across channels. Empty only when KSP has not yet assigned a flight
    /// id (its uninitialised 0).</summary>
    [SitrepUnit(Units.Id)]
    public string Id { get; set; } = "";

    /// <summary>The parent part's <c>flightID</c> as a string; <c>null</c> for the
    /// root part.</summary>
    [SitrepUnit(Units.Id)]
    public string? ParentId { get; set; }

    /// <summary><c>Part.partInfo.name</c> (the <c>AvailablePart.name</c> config
    /// id, e.g. <c>"solarPanels1"</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";

    /// <summary><c>Part.partInfo.title</c> (the display title, e.g. <c>"OX-STAT
    /// Photovoltaic Panels"</c>).</summary>
    [SitrepUnit(Units.Text)]
    public string Title { get; set; } = "";

    /// <summary><c>Part.orgPos</c>: the part's original vessel-local position
    /// (metres, vessel frame).</summary>
    [SitrepUnit(Units.Metres)]
    [SitrepFrame(Frames.VesselLocal)]
    public Vec3 Position { get; set; } = new();

    /// <summary>The part's local up axis (<c>Part.orgRot * Vector3.up</c>), for
    /// orienting flow or thrust glyphs, as a unit vector in the vessel's
    /// frame. <c>null</c> when absent.</summary>
    [SitrepUnit(Units.Dimensionless)]
    // orgRot is the part's rotation within the construction frame, so the rotated axis lands in the vessel's frame and not the part's own.
    [SitrepFrame(Frames.VesselLocal)]
    public Vec3? Up { get; set; }

    /// <summary>The part's bounding box, in the part's own frame. Always present.</summary>
    public PartBounds Bounds { get; set; } = new();

    /// <summary><c>Part.mass</c>: dry mass (tonnes).</summary>
    [SitrepUnit(Units.Tonnes)]
    public double DryMass { get; set; }

    /// <summary><c>Part.inverseStage</c>, in KSP's own inverted staging
    /// numbering, unchanged; see <see
    /// cref="VesselStructure.CurrentStage"/>.</summary>
    [SitrepUnit(Units.Id)]
    public int InverseStage { get; set; }

    /// <summary><c>Part.maxTemp</c>: internal max temperature (K).</summary>
    [SitrepUnit(Units.Kelvin)]
    public double MaxTemp { get; set; }

    /// <summary><c>Part.skinMaxTemp</c>: maximum skin temperature (K);
    /// <c>null</c> where KSP reports <c>-1</c>, no skin-thermal model.</summary>
    [SitrepUnit(Units.Kelvin)]
    public double? SkinMaxTemp { get; set; }

    /// <summary><c>Part.temperature</c>: current internal temperature (K);
    /// <c>null</c> where KSP reports <c>-1</c>, not yet simulated.</summary>
    [SitrepUnit(Units.Kelvin)]
    public double? CurrentTemp { get; set; }

    /// <summary><c>Part.skinTemperature</c>: current skin temperature
    /// (K); <c>null</c> when absent, such as before physics runs.</summary>
    [SitrepUnit(Units.Kelvin)]
    public double? SkinTemp { get; set; }

    /// <summary><c>Part.partInfo.category</c> (<c>PartCategories</c> enum name,
    /// e.g. <c>"Engine"</c>). A display label; see <see
    /// cref="CategoryOrdinal"/>.</summary>
    [SitrepUnit(Units.Text)]
    public string Category { get; set; } = "";

    /// <summary>
    /// <see cref="Category"/>'s KSP ORDINAL, typed to
    /// <see cref="KspPartCategory"/>.
    ///
    /// <para>Classify by this rather than by <see cref="Category"/>'s name,
    /// which is a display label and changes if KSP renames a member.</para>
    ///
    /// <para><c>null</c> when the part had no <c>partInfo</c> to read, the same
    /// case that leaves <see cref="Category"/> empty. <c>PartCategories.none</c>
    /// is <c>-1</c> and is a real value, not an absence.</para>
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public KspPartCategory? CategoryOrdinal { get; set; }

    /// <summary>Each <c>PartModule</c>'s CLR class name (e.g.
    /// <c>"ModuleEngines"</c>, <c>"CModuleFuelLine"</c>), which is what a
    /// client classifies a part by.</summary>
    [SitrepUnit(Units.Text)]
    public List<string> Modules { get; set; } = new();

    /// <summary><c>Part.isRobotic()</c>: a Breaking Ground robotic servo
    /// part.</summary>
    [SitrepUnit(Units.Flag)]
    public bool IsRobotics { get; set; }

    /// <summary>True when the part carries a solar panel, alternator,
    /// EC-producing converter, or an ElectricCharge resource
    /// capacity.</summary>
    [SitrepUnit(Units.Flag)]
    public bool IsPowerRelated { get; set; }

    /// <summary>For a fuel-line part, the stringified <c>flightID</c> of the
    /// part it feeds; <c>null</c> otherwise.</summary>
    [SitrepUnit(Units.Id)]
    public string? FuelLineTargetId { get; set; }

    /// <summary>
    /// Every resource this part carries, keyed by resource name (e.g.
    /// <c>"ElectricCharge"</c>): storage plus live production or consumption.
    /// Empty when the part carries no resources.
    /// </summary>
    public Dictionary<string, PartResourceFlow> Resources { get; set; } = new();

    /// <summary>
    /// Per-module behavioural state (solar panel deployed, engine firing,
    /// parachute waiting to deploy, and so on): one entry per module on the
    /// part that maps to <see cref="PartModuleState"/>'s vocabulary, in
    /// <c>Part.Modules</c> order. Empty when the part carries no module of a
    /// mapped type.
    /// </summary>
    public List<PartModuleState> ModuleStates { get; set; } = new();

    /// <summary>
    /// Action-group bindings on this part: one entry per bound part action
    /// (<see cref="ActionBinding.Action"/> = <c>BaseAction.guiName</c>, and the
    /// named groups its <c>BaseAction.actionGroup</c> Flags bitmask decodes to).
    /// Per action, not per part. Empty when no action on the part is bound to
    /// any group. Derive an action group's human-readable caption from this.
    /// </summary>
    public List<ActionBinding> ActionBindings { get; set; } = new();
}

/// <summary> One action-group binding in <see
/// cref="VesselPart.ActionBindings"/>: a single part action and the named
/// action groups it fires with. <see cref="Groups"/> are the
/// <c>KSPActionGroup</c> enum member names (<c>SAS</c>/<c>RCS</c>/
/// <c>Brakes</c>/<c>Gear</c>/<c>Light</c>/<c>Abort</c>/<c>Stage</c>/
/// <c>Custom01</c>...) the action's Flags bitmask decodes to (<c>None</c>
/// excluded).
/// </summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ActionBinding
{
    /// <summary>The action's PAW label: <c>BaseAction.guiName</c> (e.g.
    /// "Toggle", "Extend Panel").</summary>
    [SitrepUnit(Units.Text)]
    public string Action { get; set; } = "";

    /// <summary>Named <c>KSPActionGroup</c> groups this action is bound to (e.g.
    /// <c>["SAS","Custom01"]</c>). Never empty: an action bound to no group is
    /// not emitted. Display labels, and possibly incomplete; see
    /// <see cref="GroupsMask"/>.</summary>
    [SitrepUnit(Units.Text)]
    public List<string> Groups { get; set; } = new();

    /// <summary>
    /// <c>BaseAction.actionGroup</c>'s raw <c>[Flags]</c> BITMASK, the whole of
    /// it. <see cref="KspActionGroup"/> names the bits.
    ///
    /// <para>A mask rather than an ordinal because <c>KSPActionGroup</c> is a
    /// flags enum: one action can fire with several groups. Prefer it to
    /// <see cref="Groups"/>, which lists only the groups this build knows by
    /// name, so a group KSP adds is missing from the names but present in the
    /// mask.</para>
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public int GroupsMask { get; set; }
}

/// <summary>
/// One resource row in <see cref="VesselPart.Resources"/>: storage
/// (<see cref="Amount"/>/<see cref="MaxAmount"/>) plus live flow
/// (<see cref="Flow"/>/<see cref="NominalFlow"/>).
///
/// <para><b>Flow scope.</b> <see cref="Flow"/> and <see cref="NominalFlow"/>
/// are populated only for modules whose live rate can be read directly: solar
/// panels (<c>ModuleDeployableSolarPanel.flowRate</c> and
/// <c>chargeRate</c>), alternators (<c>ModuleAlternator.outputRate</c>), and
/// engine propellant consumption (<c>Propellant.currentRequirement</c>, signed
/// negative). Resource converters, fuel cells and drills report storage
/// only, with no rate. <see cref="NominalFlow"/> is <c>null</c> whenever it
/// would equal <see cref="Flow"/>.</para>
/// <internal>
/// The same "if cheap" scoping KspHost.BuildPartsPower establishes for
/// totalProductionEc: no hand-simulation of KSP's resource solver.
/// </internal>
/// </summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class PartResourceFlow
{
    /// <summary><c>PartResource.amount</c>: current stored amount.</summary>
    [SitrepUnit(Units.ResourceUnits)]
    public double Amount { get; set; }

    /// <summary><c>PartResource.maxAmount</c>: storage capacity.</summary>
    [SitrepUnit(Units.ResourceUnits)]
    public double MaxAmount { get; set; }

    /// <summary>Signed units per second: positive is producing, negative is
    /// consuming. <c>null</c> when no module with a readable rate
    /// contributes.</summary>
    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public double? Flow { get; set; }

    /// <summary>The rate at 100% efficiency, with the same sign as
    /// <see cref="Flow"/> (a solar panel's rated output). <c>null</c> when no
    /// module has a nominal rate, or when it would equal <see
    /// cref="Flow"/>.</summary>
    [SitrepUnit(Units.ResourceUnitsPerSecond)]
    public double? NominalFlow { get; set; }
}

/// <summary>
/// One module's behavioural state in <see cref="VesselPart.ModuleStates"/>.
/// <see cref="Type"/> discriminates the module and <see cref="State"/> carries
/// the standardised deploy/activation word, whose vocabulary is on that
/// property.
/// </summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class PartModuleState
{
    /// <summary>Discriminator: <c>solarPanel</c> / <c>radiator</c> /
    /// <c>antenna</c> / <c>parachute</c> / <c>engine</c> / <c>drill</c> /
    /// <c>landingGear</c>. <c>cargoBay</c> is a defined vocabulary value that
    /// no module currently produces.
    /// <internal>
    /// See KspHost.BuildPartModuleStates' doc comment for why cargoBay has no
    /// module.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Type { get; set; } = "";

    /// <summary>
    /// The standardised deploy/activation state, one closed vocabulary across
    /// every <see cref="Type"/> rather than each module's own enum spelling.
    ///
    /// <list type="bullet">
    /// <item><c>extended</c> / <c>retracted</c> / <c>deploying</c> /
    /// <c>retracting</c>, for anything that animates: solar panels, radiators,
    /// antennas, landing gear.</item>
    /// <item><c>stowed</c> / <c>armed</c> / <c>extended</c> / <c>broken</c>, the
    /// parachute lifecycle. <c>armed</c> means staged and waiting for its
    /// atmospheric trigger, which is not the same as deployed.</item>
    /// <item><c>active</c> / <c>inactive</c>, for engines and drills.</item>
    /// <item><c>unknown</c> when the underlying game enum maps to none of the
    /// above, which is a statement that the state was read and not recognised
    /// rather than a stand-in for retracted.</item>
    /// </list>
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string State { get; set; } = "";

    /// <summary>Solar-panel-only: sun-tracking gimbal active. <c>null</c> for
    /// every other type.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Tracking { get; set; }

    /// <summary>Engine-only: fuel-starved. <c>null</c> unless <c>true</c>
    /// (never emitted as a bare <c>false</c>).</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Flameout { get; set; }
}

/// <summary>
/// A <see cref="VesselPart"/>'s local bounding box: <see cref="Size"/> is the
/// part's <c>prefabSize</c> (a per-part-type constant approximating its
/// rendered bounds), <see cref="Center"/> the mesh-centre offset from the
/// part's own origin (<c>Part.boundsCentroidOffset</c>). A fuel-line part
/// reports bounds wrapping the whole conduit, as KSP does.
///
/// <para>Both are in the PART's own frame (<c>part-local</c>), never the
/// vessel's: they are authored fields of the part's config node, so one value
/// has to serve every instance of that part however it was assembled. A
/// consumer placing the box on a ship rotates both by that part's <c>orgRot</c>
/// before adding <see cref="VesselPart.Position"/>, which is
/// <c>vessel-local</c>.</para>
/// </summary>
/// <category>Parts</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class PartBounds
{
    /// <summary><c>Part.prefabSize</c>: the part's untransformed bounding-box
    /// extents (metres).</summary>
    [SitrepUnit(Units.Metres)]
    [SitrepFrame(Frames.PartLocal)]
    public Vec3 Size { get; set; } = new();

    /// <summary> <c>Part.boundsCentroidOffset</c>: mesh-centre offset from the
    /// part's own origin (metres, PART-local); <c>null</c> when absent.
    ///
    /// <para>Part-local, not vessel-local: an authored per-part-type constant
    /// like <see cref="Size"/> beside it, so one value serves every instance of
    /// the part at whatever attitude it was assembled at. <see
    /// cref="VesselPart.Position"/> is <c>vessel-local</c>, so adding the two
    /// raw mixes frames and lands the box somewhere the part is not; rotate
    /// this one by the part's <c>orgRot</c> first.</para>
    /// </summary>
    [SitrepUnit(Units.Metres)]
    [SitrepFrame(Frames.PartLocal)]
    public Vec3? Center { get; set; }
}
