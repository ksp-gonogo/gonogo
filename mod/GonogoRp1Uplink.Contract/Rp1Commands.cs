#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif
using System.Collections.Generic;
using Sitrep.Contract;

namespace GonogoRp1Uplink;

/// <summary>
/// Args for <c>rp1.build.repeat</c>: build another copy of a design RP-1 already
/// holds, at the launch complex that holds it.
///
/// <para>ONE field, and it is an id rather than a name. Under RP-1 a design is
/// built repeatedly on purpose (that is the career loop: design once, fly the
/// same vehicle many times), so several vehicles of the same name sit in the
/// same complex and a name addresses none of them. The id is RP-1's own
/// <c>KCTPersistentID</c>, published on <see cref="Rp1BuildItemEntry.Id"/> and
/// <see cref="Rp1WarehouseItemEntry.Id"/>.</para>
///
/// <para>The complex is NOT an argument. RP-1 stores the launch complex on the
/// vehicle, and a copy is built where its original was: a client that could
/// name a destination could name one whose limits the vehicle does not meet,
/// and the operator's question is "another one of these", not "another one of
/// these somewhere else". Moving a design between complexes is a different
/// action and would be a different command.</para>
///
/// <para>Declared in this Uplink's own contract slice, never in
/// <c>Sitrep.Contract</c>: no Uplink-specific wire type may live in core, even
/// for an Uplink that ships bundled.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1BuildRepeatArgs
{
    /// <summary>The vehicle to copy, by RP-1's <c>KCTPersistentID</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string? Id { get; set; }
}

/// <summary>
/// Args for <c>rp1.vehicle.rollout</c>: move a finished vehicle out of its
/// complex's warehouse and onto a launch pad.
///
/// <para>The vehicle is addressed the same way and for the same reason
/// <see cref="Rp1BuildRepeatArgs.Id"/> is.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1RolloutArgs
{
    /// <summary>The finished vehicle to roll out, by RP-1's <c>KCTPersistentID</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string? Id { get; set; }

    /// <summary>
    /// Which pad, by the name RP-1 gives it and <c>rp1.pads[].name</c>
    /// publishes. <b>REQUIRED</b>: the command refuses when it is absent, even
    /// when only one pad could possibly have been meant.
    ///
    /// <para>Nullable in the type only because every field on this wire is, so
    /// that a client sending an older shape fails as a refusal rather than a
    /// deserialisation error. An absent pad is never a default.</para>
    ///
    /// <para><b>Operator ruling, 2026-08-27.</b> An earlier draft let this be
    /// omitted and used the single free pad when there was exactly one. That was
    /// rejected, and the reason is worth keeping: choosing a launch site is a
    /// decision an operator makes, and a mod that silently picks when the choice
    /// looks obvious has taken the decision anyway. Requiring it also means the
    /// wire RECORDS what was chosen, so a dispatch log says which pad an operator
    /// sent a vehicle to rather than leaving it to be inferred from whichever pad
    /// happened to be free at the time.</para>
    ///
    /// <para>The client is where the convenience belongs: it may PRESELECT the
    /// only eligible pad so a one-pad complex is still a single press, but the
    /// command it sends carries the name explicitly. Eligibility is on the wire
    /// for it to do that with, as <c>rp1.pads[].state</c> plus
    /// <c>rp1.pads[].hasVesselWaiting</c> for the pad half and
    /// <c>rp1.warehouse[].rolloutRefusals</c> for the vehicle half.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? Pad { get; set; }
}

/// <summary>
/// Args for <c>rp1.vehicle.rollback</c> and <c>rp1.vehicle.scrap</c>: the two
/// commands that need nothing but a vehicle.
///
/// <para>One type for both, because they take the same single argument and a
/// second identical class would only invite the two to drift. What they do with
/// it is entirely different and lives in the handlers.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1VehicleArgs
{
    /// <summary>The vehicle, by RP-1's <c>KCTPersistentID</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string? Id { get; set; }
}

/// <summary>
/// Args for <c>rp1.complex.rush</c>: put a launch complex into rush mode, or
/// take it out.
///
/// <para><b>Why this is not a per-vehicle command.</b> RP-1 keeps
/// <c>IsRushing</c> as a bool on the LAUNCH COMPLEX, not on a vehicle: rushing
/// is a mode the whole complex is in, every project inside it is rushed
/// together, and the cost is a standing multiplier on engineer salaries rather
/// than a purchase. A command shaped like "rush this build" would be a lie
/// about what the game does, so the complex is the subject and the vehicle is
/// not addressable here at all.</para>
///
/// <para>A SET rather than a toggle. An operator commanding from a remote
/// vantage is reading a complex's state as it was, and a toggle applied to a
/// state that has since changed does the opposite of what was asked; a set
/// lands on the state that was asked for whenever it arrives.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1ComplexRushArgs
{
    /// <summary>The complex, by the GUID <c>rp1.complexes[].lcId</c> publishes.</summary>
    [SitrepUnit(Units.Id)]
    public string? LcId { get; set; }

    /// <summary>The mode to leave the complex in: rushing, or not.</summary>
    [SitrepUnit(Units.Flag)]
    public bool? Rushing { get; set; }
}

/// <summary>
/// Args for <c>rp1.personnel.assign</c>: move engineers between a centre's
/// unassigned pool and one of its launch complexes.
///
/// <para><b>It hires nobody.</b> Under RP-1 hiring and assigning are two
/// different acts with two different costs: hiring spends funds up front and
/// raises the payroll, assigning spends nothing and only decides which complex
/// the crew already on the books works at. This command is the second, so it can
/// never grow the headcount and can never take the career's balance down.</para>
///
/// <para>A SET rather than a delta, for the reason
/// <see cref="Rp1ComplexRushArgs"/> gives: an operator commanding from a remote
/// vantage is reading a crew count as it was, and "+5" applied to a count that
/// has since moved lands somewhere nobody chose. A target lands where it was
/// aimed however stale the view was, and re-sending it changes nothing.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1PersonnelAssignArgs
{
    /// <summary>The complex, by the GUID <c>rp1.complexes[].lcId</c> publishes.</summary>
    [SitrepUnit(Units.Id)]
    public string? LcId { get; set; }

    /// <summary>
    /// How many engineers this complex should end up with.
    ///
    /// <para>REQUIRED, and refused when absent: there is no sensible default for
    /// a crew size. Refused rather than clamped when it is above the complex's
    /// own maximum or above what the centre's pool can supply, because a clamp
    /// would report success for a number the operator did not ask for.</para>
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? Engineers { get; set; }
}

/// <summary>
/// Args for <c>rp1.build.start</c>: begin integrating a design RP-1 has never
/// held, from one of the save's own craft files.
///
/// <para><b>Why this exists beside <see cref="Rp1BuildRepeatArgs"/>.</b> The
/// repeat command copies a vehicle RP-1 already has, at the complex that holds
/// it. It can order a second Atlas and can never order a first one, which left
/// an operator able to watch a career and unable to start anything in it. This
/// is the general case, and the two share no argument: one addresses a vehicle
/// in the model, the other a file on disk.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1BuildStartArgs
{
    /// <summary>
    /// The craft FILE's own name, without its <c>.craft</c> extension, as
    /// <c>rp1.buildable[].craftFile</c> publishes it.
    ///
    /// <para>Not the ship name an operator reads. KSP keeps the ship's name
    /// inside the file and lets the two differ, so two files can carry one ship
    /// name and a command addressing that would build whichever the directory
    /// happened to list first. A file name is unique inside its folder by
    /// construction, which is what makes it an address.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? CraftFile { get; set; }

    /// <summary>
    /// Which editor's folder holds the file, as the KSP ordinal
    /// <c>rp1.buildable[].facility</c> publishes.
    ///
    /// <para><b>REQUIRED</b>, and not a hint: the VAB and SPH folders are
    /// separate and may each hold a file of the same name. It also decides
    /// which kind of complex the vehicle belongs at, so a substituted default
    /// would order a spaceplane integrated at a launch pad.</para>
    /// </summary>
    [SitrepUnit(Units.Enumeration)]
    public KspEditorFacility? Facility { get; set; }

    /// <summary>
    /// Which launch complex integrates it, by the GUID
    /// <c>rp1.complexes[].lcId</c> publishes.
    ///
    /// <para><b>REQUIRED</b>: the command refuses when it is absent, even when
    /// only one complex could possibly have been meant. The same operator
    /// ruling that governs <see cref="Rp1RolloutArgs.Pad"/> applies unchanged,
    /// and applies harder here: a complex decides the mass and size envelope,
    /// the human rating and the build rate, so choosing one is the whole of the
    /// decision an operator is making. Requiring it also means the wire RECORDS
    /// which complex was chosen rather than leaving it to be inferred.</para>
    ///
    /// <para>The client is where the convenience belongs: it may PRESELECT the
    /// only complex that would take the craft, so a one-complex career is still
    /// a single press, and eligibility is on the wire for it to do that with as
    /// <c>rp1.buildable[].complexes[].refusals</c>.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? LcId { get; set; }
}

/// <summary>
/// Which strategy to commit to, for <c>rp1.strategy.activate</c>.
/// </summary>
/// <remarks>
/// <para>A leader AND a program, because RP-1 makes them one system: a "leader"
/// is any strategy whose department is not Programs, and both are the same class
/// family. The command does not ask the operator which kind they meant, because
/// the game does not: it asserts the kind itself and takes the matching
/// procedure.</para>
/// </remarks>
[SitrepContract]
public class Rp1StrategyActivateArgs
{
    /// <summary>
    /// The strategy, by the id <c>career.status.strategies.all[].id</c>
    /// publishes.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? StrategyId { get; set; }

    /// <summary>
    /// The commitment level, where the strategy has a slider.
    ///
    /// <para>Absent means the strategy's own default. It is a FRACTION rather
    /// than a percentage, matching <c>factor</c> on the wire, and it scales the
    /// up-front cost, which is why the control that sends it must show the
    /// balance beside it.</para>
    ///
    /// <para>Written before the gate is asked and put back if the game refuses,
    /// because <c>Strategy.Factor</c> is a plain persisted setter: a refused
    /// activation that left it written would change the commitment level on the
    /// save with nothing to show for it.</para>
    /// </summary>
    [SitrepUnit(Units.Ratio)]
    public double? Factor { get; set; }
}

/// <summary>
/// Args for <c>rp1.facility.upgrade</c>: queue a space-centre facility's next
/// tier as an RP-1 construction project.
///
/// <para><b>It buys nothing.</b> Under RP-1 a facility upgrade is not a
/// purchase at all: the project is added to a construction queue and the funds
/// are drawn down as it progresses, at a rate that falls when the career is
/// short. So this command spends nothing at the moment it lands, and it never
/// refuses on affordability, because RP-1 itself does not.</para>
///
/// <para>ONE field, and no target tier. RP-1 models a single step, from the
/// facility's current level to the one above it, and there is no such thing as
/// a two-tier project: a command taking a destination would have to queue
/// several, and the second could not be costed until the first completed.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1FacilityUpgradeArgs
{
    /// <summary>
    /// Which facility, by the key <c>career.status.facilities</c> is keyed on
    /// (<c>"LaunchPad"</c>, <c>"VehicleAssemblyBuilding"</c>, and the rest of
    /// KSP's <c>SpaceCenterFacility</c> names).
    ///
    /// <para>A full facility id (<c>"SpaceCenter/LaunchPad"</c>) is accepted
    /// too and means the same thing: KSP's own normaliser decides, so the two
    /// forms cannot disagree about which building was meant.</para>
    ///
    /// <para>A name whose last segment is not one of KSP's own facilities is
    /// REFUSED rather than guessed at. RP-1 reads the building type off the
    /// clickable model rather than the id and falls through to the Vehicle
    /// Assembly Building for anything it does not recognise, so guessing here
    /// would queue an upgrade against the wrong building on a modded or
    /// KSCSwitcher site.</para>
    ///
    /// <para>The cost and the balance to show beside this control are on the
    /// same wire, on <c>career.status</c>: <c>facilities[&lt;name&gt;].upgradeCost</c>
    /// is the identical figure RP-1 puts on the project, and
    /// <c>economy.funds</c> sits in the same payload. Both are null outside the
    /// space centre, which is also where this command is refused, so the
    /// control has a price whenever it has a press.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? Facility { get; set; }
}

/// <summary>
/// Args for <c>rp1.tech.research</c>: put a tech node on RP-1's research queue.
///
/// <para><b>Why this exists rather than <c>career.tech.unlock</c>.</b> Under a
/// managed save that command is refused, and correctly: core buys the node
/// outright through <c>ResearchAndDevelopment.UnlockProtoTechNode</c>, which RP-1
/// does not patch, so the stock write lands a researched node at a stock price
/// beside a research queue that never heard of it. Under RP-1 a node is a
/// commitment researchers work through at a rate, and starting one is a
/// different act with a different shape, so it is a different command.</para>
///
/// <para><b>It spends science, at once.</b> RP-1 charges the whole cost AT
/// ENQUEUE rather than on completion, which is why the control that sends this
/// has to show the balance beside it. Both figures are already on the wire:
/// <c>career.status.economy.science</c> for the balance and
/// <c>career.status.tech.nodes[].scienceCost</c> for the price, and the second is
/// the exact integer that gets charged.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1TechResearchArgs
{
    /// <summary>
    /// The node, by the tech id <c>career.status.tech.nodes[].id</c> publishes.
    ///
    /// <para>Not the title an operator reads. A tech tree a mod has replaced can
    /// carry two nodes with one title, and the title is localised besides, so it
    /// addresses nothing reliably. The id is what the tree, the save and RP-1's
    /// own queue all key on.</para>
    ///
    /// <para>REQUIRED, and refused when absent. There is no node a missing id
    /// could sensibly mean.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? TechId { get; set; }
}

/// <summary>
/// Args for the two target cancels, which take none.
///
/// <para>Neither <c>rp1.hireTarget.cancel</c> nor <c>rp1.fundTarget.cancel</c>
/// identifies WHICH target to withdraw, because RP-1 holds exactly one of each:
/// the hire instruction is a single field whose own
/// <c>Rp1HireTarget.IsResearch</c> says which staff it hires, and setting a new
/// one replaces it. A command carrying an id would imply a roster that does not
/// exist.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1TargetCancelArgs
{
}

/// <summary>
/// Args for <c>rp1.hireTarget.set</c>: stand up an instruction to keep hiring
/// until the staff reaches a number.
///
/// <para>The reserve is the OPERATOR's, not RP-1's. It is the balance the
/// instruction will not spend below, and it is the whole reason a standing hire
/// order is safe to give: without it the career would buy staff until the money
/// ran out. RP-1 asks for it on the same dialog as the headcount, so a control
/// that offers one without the other is offering half a decision.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1HireTargetSetArgs
{
    /// <summary>
    /// The headcount to hire up to. Must exceed the current count: RP-1 refuses
    /// otherwise, in those words, because a target at or below where you already
    /// are is not an instruction.
    /// </summary>
    [SitrepUnit(Units.Count)]
    public int? TargetCount { get; set; }

    /// <summary>
    /// The balance to keep back. Hiring stops rather than spending below it.
    /// </summary>
    [SitrepUnit(Units.Funds)]
    public double? ReserveFunds { get; set; }

    /// <summary>
    /// The launch complex to staff with engineers, by the key
    /// <c>rp1.complexes[].lcId</c> carries. ABSENT hires RESEARCHERS, which is
    /// how RP-1 distinguishes the two: it stores no kind field, only whether a
    /// complex is named.
    ///
    /// <para>A named complex also caps the target at its maximum engineers, so a
    /// number above that is clamped rather than refused.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? LcId { get; set; }
}

/// <summary>
/// Args for <c>rp1.fundTarget.set</c>: stop the next warp once the balance
/// reaches a figure.
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1FundTargetSetArgs
{
    /// <summary>
    /// The balance to warp toward. RP-1 refuses a figure equal to the current
    /// balance ("already at this funding"), and refuses one it cannot reach
    /// inside its own two-year search, which is a real answer about the career's
    /// income rather than a validation quibble.
    /// </summary>
    [SitrepUnit(Units.Funds)]
    public double? TargetFunds { get; set; }
}

/// <summary>
/// Args for <c>rp1.training.enrol</c>: start a training course, which under RP-1
/// is one act rather than two.
///
/// <para><b>There is no course to enrol into.</b> RP-1's own screen builds a
/// course from a template, collects its students, and only puts it on the roster
/// once it has STARTED, so an enrolled-but-unstarted course never exists to be
/// added to. That is why this command names a template and a crew together: it
/// is the whole press.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1TrainingEnrolArgs
{
    /// <summary>
    /// The training to run, by the id <c>rp1.trainingCatalogue[].id</c> carries.
    ///
    /// <para>REQUIRED. There is no training a missing id could sensibly mean.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? TemplateId { get; set; }

    /// <summary>
    /// The kerbals to enrol, by the names <c>spaceCenter.crewRoster</c> and
    /// <c>rp1.crew</c> both key on.
    ///
    /// <para>All of them or none: a kerbal RP-1 will not take (already training,
    /// grounded, off-world, an applicant rather than crew, or barred by the
    /// training's own prerequisite) refuses the whole command by name rather than
    /// being dropped from a course that then starts one seat short. RP-1's own
    /// <c>AddStudent</c> checks none of that, so a partial enrolment would be
    /// silent.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public List<string>? Crew { get; set; }
}

/// <summary>
/// Args for <c>rp1.training.cancel</c> and <c>rp1.training.remove</c>, RP-1's two
/// distinct ways out of a course.
///
/// <para><b>Addressed by kerbal, not by course</b>, which is how RP-1 addresses
/// both: each button is drawn on a selected naut's row. It is also the only
/// unambiguous key we have, since <c>rp1.training[].id</c> is the TEMPLATE's id
/// and two live courses could share it. A kerbal is on at most one course, which
/// RP-1 keeps true by refusing a grounded kerbal as a student.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1TrainingLeaveArgs
{
    /// <summary>
    /// The kerbal whose course this is about.
    ///
    /// <para>REQUIRED. For <c>cancel</c> it selects the course and every student
    /// on it comes off; for <c>remove</c> it is the one student who leaves.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? CrewName { get; set; }
}

/// <summary>
/// The size envelope a launch complex is built or renovated to, in metres per
/// axis.
///
/// <para>Named for the axes <c>rp1.complexes[]</c> publishes
/// (<c>sizeMaxWidth</c>, <c>sizeMaxHeight</c>, <c>sizeMaxDepth</c>) rather than
/// the labels RP-1's own window uses, which calls the depth axis "Length". A
/// client reads a complex's envelope off the wire and sends the same field names
/// back, so the round trip is the same three words in both directions.</para>
///
/// <para>All three are REQUIRED on both commands that carry this. RP-1 refuses a
/// zero size vector outright ("Please enter a valid size"), and a substituted
/// default on any one axis would build a complex to an envelope nobody chose:
/// the axes price independently, and height prices at twice the rate of the other
/// two.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1ComplexSizeArgs
{
    /// <summary>The x axis, as <c>rp1.complexes[].sizeMaxWidth</c> publishes it.</summary>
    [SitrepUnit(Units.Metres)]
    public double? SizeMaxWidth { get; set; }

    /// <summary>The y axis, as <c>rp1.complexes[].sizeMaxHeight</c> publishes it. RP-1 prices this axis at full rate and the other two at half.</summary>
    [SitrepUnit(Units.Metres)]
    public double? SizeMaxHeight { get; set; }

    /// <summary>The z axis, as <c>rp1.complexes[].sizeMaxDepth</c> publishes it. RP-1's own window labels this one "Length".</summary>
    [SitrepUnit(Units.Metres)]
    public double? SizeMaxDepth { get; set; }
}

/// <summary>
/// Args for <c>rp1.complex.new</c>: build a launch complex the career does not
/// have.
///
/// <para><b>No complex type.</b> RP-1 always builds a Pad: its new-complex path
/// assigns <c>lcType = LaunchComplexType.Pad</c> unconditionally, and the one
/// Hangar a career has is seeded at career start from
/// <c>LCData.StartingHangar</c> and can never be created or dismantled. An
/// argument for the type would offer a choice the game does not have and a value
/// (Hangar) that would produce a complex RP-1's own code paths do not expect.</para>
///
/// <para><b>It spends nothing at the moment it lands</b>, the same as
/// <see cref="Rp1FacilityUpgradeArgs"/>: the complex goes on RP-1's construction
/// queue and the funds are drawn down as it progresses. So the command never
/// refuses on affordability, because RP-1 itself does not. The price is still the
/// operator's to see before pressing, and it is the figure
/// <c>rp1.constructions[].cost</c> carries once the project exists.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1ComplexNewArgs
{
    /// <summary>
    /// Which space centre builds it, by the key <c>rp1.centres[].kscName</c>
    /// carries.
    ///
    /// <para><b>REQUIRED</b>, and this is the one place these commands ask for a
    /// choice RP-1 does not offer: its window has no centre picker and always
    /// builds wherever the game's own view happens to be. The
    /// <see cref="Rp1RolloutArgs.Pad"/> ruling is what settles it anyway: a
    /// career under KSCSwitcher has several centres, the client can preselect
    /// when there is only one, and the wire RECORDS which was chosen rather than
    /// leaving it to be inferred from where the camera was.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? KscName { get; set; }

    /// <summary>
    /// What to call it. REQUIRED, and refused when it duplicates a complex
    /// already at that centre, both in RP-1's own words.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? Name { get; set; }

    /// <summary>
    /// The tonnage limit. REQUIRED: RP-1 refuses a zero ("Please enter a valid
    /// tonnage limit"), and it is the figure the whole pad price is a curve over.
    ///
    /// <para>It also fixes the complex's renovation envelope for life. RP-1
    /// records the build tonnage as <c>massOrig</c> and every later modify is
    /// held to <c>max(3, floor(massOrig x 2))</c> above and
    /// <c>max(1, ceil(massOrig x 0.5))</c> below, so this number decides not only
    /// what the complex can launch but what it can ever be renovated into.</para>
    /// </summary>
    [SitrepUnit(Units.Tonnes)]
    public double? MassMax { get; set; }

    /// <summary>The size envelope. REQUIRED, all three axes.</summary>
    public Rp1ComplexSizeArgs? Size { get; set; }

    /// <summary>
    /// Whether it may launch crew. REQUIRED rather than defaulted to false:
    /// human rating multiplies the pad cost by 1.5 and the integration cost by
    /// 2, so a substituted default would halve or double the price of the thing
    /// being bought.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? HumanRated { get; set; }

    /// <summary>
    /// The propellants and other fluids the complex handles, keyed by KSP
    /// resource name, in units. ABSENT means none, which is a complex that can
    /// integrate a vehicle and fuel nothing.
    ///
    /// <para>RP-1 keeps this on the complex as <c>resourcesHandled</c> and prices
    /// each entry as a tank; the resources RP-1 will accept are the ones its own
    /// list offers, which is <c>Database.ResourceInfo.LCResourceTypes</c> filtered
    /// to fluids and minus the ones a complex of this kind ignores. A name outside
    /// that set is REFUSED by name rather than dropped, because a dropped
    /// resource is a complex that cannot fuel the vehicle it was built for and
    /// says nothing about why.</para>
    ///
    /// <para>Amounts are rounded UP to a whole unit, which is what RP-1's own
    /// field does (<c>Math.Ceiling</c>) before it stores them.</para>
    ///
    /// <para>There is NO separate resources command. RP-1's Resources window
    /// edits the same pending complex this dialog does and is committed by the
    /// same press, and no RP-1 path changes an operational complex's resources
    /// without a renovation. So resources are a field of building and renovating,
    /// not an act of their own.</para>
    /// </summary>
    public Dictionary<string, double>? Resources { get; set; }

    /// <summary>
    /// Put unassigned engineers on it when construction completes, up to its
    /// maximum. RP-1 offers this as a toggle on the same dialog and stores the
    /// answer on the construction project as <c>engineersToReadd</c>.
    ///
    /// <para>ABSENT means false, and that is a defaulted value rather than a
    /// refusal because unlike the priced fields above it changes nothing about
    /// what is bought: it decides only whether a later staffing act happens by
    /// itself, and false is the state an operator gets by not asking.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? AssignEngineersOnComplete { get; set; }
}

/// <summary>
/// Args for <c>rp1.complex.modify</c>: renovate a complex the career already
/// has, into a new envelope.
///
/// <para><b>IT UNASSIGNS EVERY ENGINEER AT THE COMPLEX</b>, and that is not a
/// side effect this Uplink chose. RP-1 does
/// <c>ChangeEngineers(lc, -lc.Engineers)</c> as the first thing it does, takes
/// the complex out of service for the whole renovation, and pops a dialog saying
/// so in these words: "All engineers at {name} have been unassigned. They will be
/// reassigned if available when renovation completes." Setting
/// <see cref="AssignEngineersOnComplete"/> is what makes the second sentence
/// true; without it RP-1's own wording is "Remember to reassign engineers to
/// {name} when it finishes renovation."</para>
///
/// <para><b>YOU PAY TO DOWNGRADE.</b> A renovation that reduces the complex is
/// not free and is not a refund: RP-1 charges half the difference in both the pad
/// and the integration halves, and any change at all to the tonnage limit carries
/// a floor of 1,000 funds. So a client must show the price for a shrink exactly
/// as it does for a growth, and must never present one as recovering anything.</para>
///
/// <para><b>No name.</b> RP-1's modify window shows the complex's name as a label
/// rather than a field, and the renovation carries the name the complex already
/// has. Renaming is <c>rp1.complex.rename</c> and is a separate, immediate act
/// that costs nothing.</para>
///
/// <para>Spends nothing when it lands, for the same reason
/// <see cref="Rp1ComplexNewArgs"/> gives.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1ComplexModifyArgs
{
    /// <summary>The complex, by the GUID <c>rp1.complexes[].lcId</c> publishes.</summary>
    [SitrepUnit(Units.Id)]
    public string? LcId { get; set; }

    /// <summary>
    /// The tonnage limit to renovate to.
    ///
    /// <para>REQUIRED for a pad complex, and REFUSED outside the complex's own
    /// renovation envelope in RP-1's words: "Cannot upgrade tonnage above the
    /// limit of {n}t" / "Cannot downgrade tonnage below the limit of {n}t". Both
    /// limits are derivable from <c>rp1.complexes[].massOrig</c>, which is on the
    /// wire for exactly this, as <c>max(3, floor(massOrig x 2))</c> and
    /// <c>max(1, ceil(massOrig x 0.5))</c>.</para>
    ///
    /// <para>The career's one HANGAR has no tonnage limit and RP-1 does not draw
    /// the field for it, so this must be ABSENT when the complex is the hangar
    /// and is refused when present: a hangar keeps whatever
    /// <c>massMax</c> it has, and a number here would be silently discarded.</para>
    /// </summary>
    [SitrepUnit(Units.Tonnes)]
    public double? MassMax { get; set; }

    /// <summary>The size envelope to renovate to. REQUIRED, all three axes, hangar included.</summary>
    public Rp1ComplexSizeArgs? Size { get; set; }

    /// <summary>
    /// Whether it may launch crew after the renovation.
    ///
    /// <para>REQUIRED for a pad complex, for the pricing reason
    /// <see cref="Rp1ComplexNewArgs.HumanRated"/> gives. Refused when present for
    /// the hangar, which RP-1 forces to human-rated and does not offer the toggle
    /// for.</para>
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? HumanRated { get; set; }

    /// <summary>
    /// The resources the complex handles after the renovation, as
    /// <see cref="Rp1ComplexNewArgs.Resources"/> describes them.
    ///
    /// <para>A SET rather than a delta, and ABSENT means NONE rather than
    /// unchanged. That is deliberate and it is the same reasoning
    /// <see cref="Rp1ComplexRushArgs"/> gives for being a set: RP-1 prices the
    /// renovation off the difference between the complex's current resources and
    /// the whole new set, so a partial instruction would price against a state the
    /// operator did not state. A client that means "keep these" sends them.</para>
    ///
    /// <para>Removing a resource is CHEAPER than adding one but is not free:
    /// RP-1 prices a reduction at a tenth of the tank, and the whole resource
    /// difference at 0.6 of a fresh tank.</para>
    /// </summary>
    public Dictionary<string, double>? Resources { get; set; }

    /// <summary>
    /// Put the unassigned engineers back when the renovation completes, up to the
    /// number that were taken off. ABSENT means false, and false is the case where
    /// RP-1 tells the operator to remember to do it themselves.
    /// </summary>
    [SitrepUnit(Units.Flag)]
    public bool? AssignEngineersOnComplete { get; set; }
}

/// <summary>
/// Args for <c>rp1.complex.rename</c>: change what a launch complex is called.
///
/// <para>Immediate and free. It is not a renovation, it queues nothing, and it
/// does not take the complex out of service: RP-1's own <c>Rename</c> assigns the
/// name on the complex and on its persisted stats and stops.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1ComplexRenameArgs
{
    /// <summary>The complex, by the GUID <c>rp1.complexes[].lcId</c> publishes.</summary>
    [SitrepUnit(Units.Id)]
    public string? LcId { get; set; }

    /// <summary>
    /// The new name. REQUIRED, and refused when it duplicates another complex at
    /// the same centre.
    ///
    /// <para>That refusal is a DELIBERATE divergence from RP-1, which is worth
    /// stating because it is the only one on this command. RP-1's
    /// <c>LaunchComplex.Rename</c> validates nothing, so its rename window will
    /// happily create the duplicate name its own build window refuses. Complexes
    /// are addressed here by GUID, so a duplicate costs this Uplink nothing at
    /// all; it costs the OPERATOR, who then reads a roster with two identically
    /// named complexes on it and cannot tell which one a reading belongs to. The
    /// wording is RP-1's own, taken from the build path that does check.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? Name { get; set; }
}

/// <summary>
/// Args for <c>rp1.complex.dismantle</c>: demolish a launch complex.
///
/// <para><b>What this actually destroys, since RP-1's own dialog says only "This
/// cannot be undone!" and names nothing.</b> The complex's EARNED BUILD
/// EFFICIENCY, which is unrecoverable: <c>LaunchComplex.Delete</c> removes the
/// complex from its efficiency group and clears the group outright when it was the
/// last member, so a complex rebuilt to the same specification starts again from
/// RP-1's floor. Both halves of that are already on the wire,
/// <c>rp1.complexes[].efficiency</c> is the figure at risk and
/// <c>rp1.complexes[].efficiencySharedWith</c> says whether it survives in a
/// sibling, so a client can say exactly what is about to be lost, which is more
/// than the game does.</para>
///
/// <para><b>It cannot destroy a vessel.</b> RP-1 refuses the dismantle outright
/// while the complex holds anything: its <c>CanDismantle</c> requires an empty
/// build list AND an empty warehouse, so by the time this command can succeed
/// there is nothing in either. RP-1's own code has a loop that scraps the
/// warehouse and it is unreachable. Emptying a complex first is
/// <c>rp1.vehicle.scrap</c>, which refunds in full.</para>
///
/// <para>It also returns the complex's engineers to the centre's unassigned pool,
/// though nothing writes them there: the pool is derived as the centre's headcount
/// minus what its complexes hold, so removing a complex frees its crew by
/// arithmetic. No engineer is lost.</para>
///
/// <para>The career's one hangar can never be dismantled, in RP-1's words.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1ComplexDismantleArgs
{
    /// <summary>The complex, by the GUID <c>rp1.complexes[].lcId</c> publishes.</summary>
    [SitrepUnit(Units.Id)]
    public string? LcId { get; set; }
}

/// <summary>
/// Args for <c>rp1.pad.new</c>: add a launch pad to an existing complex.
///
/// <para>The pad INHERITS the complex's envelope and cannot have one of its own:
/// RP-1 builds it at the complex's own tonnage level and its window shows those
/// limits as read-only labels. So this command carries a name and nothing else
/// about the pad.</para>
///
/// <para>Goes on the construction queue and draws its funds down as it
/// progresses, the same as <see cref="Rp1ComplexNewArgs"/>. An extra pad is
/// priced at the complex's own pad cost times RP-1's additional-pad multiplier,
/// which ships at half.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1PadNewArgs
{
    /// <summary>The complex to add it to, by the GUID <c>rp1.complexes[].lcId</c> publishes.</summary>
    [SitrepUnit(Units.Id)]
    public string? LcId { get; set; }

    /// <summary>
    /// What to call it. REQUIRED, and refused when it duplicates a pad already at
    /// this complex, both in RP-1's own words.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? Name { get; set; }
}

/// <summary>
/// Args for <c>rp1.pad.rename</c>: change what one of a complex's pads is called.
///
/// <para><b>Why this exists rather than being left to the game.</b> RP-1's own
/// pad rename FAILS SILENTLY on a duplicate name: <c>LCLaunchPad.Rename</c>
/// returns without doing anything when another pad at the complex already has
/// that name, and the rename window that called it reports nothing at all. The
/// operator presses Save, the window closes, and the pad keeps its old name. This
/// command refuses instead, and says which name was taken.</para>
///
/// <para>Not cosmetic on the inside, which is why the whole act is RP-1's to
/// perform rather than a field to write: a pad's name is the key its rollouts and
/// its pending construction are stored against, and RP-1's own rename rewrites
/// both.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1PadRenameArgs
{
    /// <summary>The complex holding the pad, by the GUID <c>rp1.complexes[].lcId</c> publishes.</summary>
    [SitrepUnit(Units.Id)]
    public string? LcId { get; set; }

    /// <summary>
    /// Which pad, by the GUID <c>rp1.pads[].padId</c> publishes.
    ///
    /// <para>The id and not the name, even though RP-1 stores rollouts against
    /// the name: a rename addressed by name would be ambiguous in exactly the
    /// state this command exists to fix, and the id is stable across the rename
    /// itself.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? PadId { get; set; }

    /// <summary>The new name. REQUIRED, and refused when another pad at the complex has it.</summary>
    [SitrepUnit(Units.Id)]
    public string? Name { get; set; }
}

/// <summary>
/// Args for <c>rp1.pad.dismantle</c>: demolish one of a complex's pads.
///
/// <para><b>A complex must keep a pad, and RP-1 enforces that by doing
/// nothing.</b> Its check is
/// <c>LaunchPadCount >= 2 &amp;&amp; !ActiveLPInstance.Delete(out reason)</c>, so
/// with one pad left the condition short-circuits: the confirmation dialog has
/// already asked "are you sure? This cannot be undone!", the operator presses
/// Yes, the window closes, and the pad is still there with no message anywhere.
/// This command refuses and says so. <c>LaunchPadCount</c> counts only
/// OPERATIONAL pads, so a complex with one working pad and one still under
/// construction cannot dismantle either.</para>
///
/// <para>Immediate and free, and it is not queued: unlike building a pad,
/// removing one happens at once.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1PadDismantleArgs
{
    /// <summary>The complex holding the pad, by the GUID <c>rp1.complexes[].lcId</c> publishes.</summary>
    [SitrepUnit(Units.Id)]
    public string? LcId { get; set; }

    /// <summary>Which pad, by the GUID <c>rp1.pads[].padId</c> publishes.</summary>
    [SitrepUnit(Units.Id)]
    public string? PadId { get; set; }
}

/// <summary>
/// Args for <c>rp1.warp.toComplete</c> and <c>rp1.warp.toFundTarget</c>, which
/// take none.
///
/// <para>Neither names WHAT to warp to, because neither is a choice: RP-1 holds
/// exactly one next-thing-to-finish (whichever of the career's projects has the
/// least time left, across every centre) and exactly one fund target. A command
/// carrying an id would imply a roster that does not exist.</para>
///
/// <para><b>There is no <c>rp1.warp.stop</c>, deliberately.</b> RP-1's warp
/// controller destroys itself the moment it observes a warp rate of zero
/// (<c>KCTWarpController::FixedUpdate</c> IL_002c-IL_003e: the rate index is read,
/// and a zero branches straight to <c>DestroyGameObject</c> and returns), so
/// core's own <c>time.setWarpIndex</c> already ends an RP-1 warp and the widget's
/// existing "1x" button already sends it. A second command to stop warping would
/// be two controls doing one thing, and the operator would have to know which of
/// them RP-1 respects. It respects both.</para>
///
/// <para>One type for both commands, as <see cref="Rp1TargetCancelArgs"/> is for
/// its two: they take the same nothing, and a second empty class would only
/// invite the two to drift.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1WarpArgs
{
}

/// <summary>
/// Args for <c>rp1.tooling.toolAll</c>: buy every tooling the ship on the editor's
/// table is missing, in one purchase.
///
/// <para>NO ARGUMENTS, and that is RP-1's own shape rather than a simplification.
/// Tool All acts on the ship currently being edited and there is no other ship it
/// could mean; a command carrying a craft id would imply a choice that does not
/// exist.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1ToolAllArgs
{
}

/// <summary>
/// Args for <c>rp1.tooling.refit</c>: reshape a part to a size whose tooling is
/// already owned.
///
/// <para><b>An EDIT, not a purchase.</b> It spends nothing and writes nothing to
/// the tooling database. It changes the craft on the editor's table so that a part
/// fits tooling the career already has, which is the other way of closing the gap
/// <c>rp1.tooling</c> reports: buy the tooling, or move the part to tooling you
/// own.</para>
///
/// <para><b>It reaches further than the part named.</b> Every symmetry counterpart
/// is resized too, and the tank material is applied across the part's group. RP-1
/// says so after the fact in a screen message; <c>rp1.tooling[].symmetryCounterparts</c>
/// carries the count so a control can say it first.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Rp1ToolingRefitArgs
{
    /// <summary>
    /// The part to reshape, by the craft id <c>rp1.tooling[].partId</c> carries.
    ///
    /// <para>Named explicitly, and never inferred from which part-action window the
    /// player has open. RP-1's own control reads that window; its underlying
    /// <c>Resize</c> takes a part, and the difference is the whole point: a channel
    /// or a command whose answer depends on a panel being open is one an operator
    /// at another console cannot use.</para>
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? PartId { get; set; }

    /// <summary>The diameter to reshape to, which should be one an owned tooling covers.</summary>
    [SitrepUnit(Units.Metres)]
    public double? Diameter { get; set; }

    /// <summary>The length to reshape to.</summary>
    [SitrepUnit(Units.Metres)]
    public double? Length { get; set; }

    /// <summary>
    /// The tank material to switch to, by RP-1's own name for it. ABSENT leaves the
    /// material alone and reshapes only, which is a resize rather than a refit and
    /// is what RP-1 calls it in that case.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? RfType { get; set; }
}
