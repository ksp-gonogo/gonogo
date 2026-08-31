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
