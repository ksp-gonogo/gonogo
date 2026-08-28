// Reflection-only bridge to RP-1's space-centre model. No compile-time reference
// to the RP-0 plugin (RP0.dll, CC-BY-NC-SA-4.0): every member is reached by
// runtime reflection, the same arm's-length pattern as AvionicsReflection.
//
// PROVENANCE. Member names are RESOLVED, not guessed: every one below was read
// out of an ilspycmd disassembly of the SHIPPED RP-1 v4.6.0.0 RP0.dll
// (GameData/RP-1/Plugins/RP0.dll from the published RP-1-v4.6.0.0.zip, whose
// source tag is c96fda7). Note the version: GonogoAvionicsUplink is locked
// against v4.5.0.0, and the two are free to disagree. Nothing here has been seen
// in a running game, because there is no RP-1 install on this machine or the
// test rig; the disassembly verifies SHAPE and never VALUE, so every lookup is
// null-safe per hop and degrades to absent rather than to a default that looks
// like a reading.
//
// WHAT IS DELIBERATELY NOT CALLED, and why it is worth the trouble:
//
//   LaunchComplex.Efficiency / .EfficiencySource, LCOpsProject.GetTimeLeft() /
//   .GetBuildRate() / .GetTimeLeftEst(), VesselProject.BuildRate,
//   ResearchProject.BuildRate / .TimeLeft
//
// all reach LCEfficiency.GetOrCreateEfficiencyForLC, which on a cache MISS
// constructs an LCEfficiency, appends it to a [Persistent] list and calls
// RefreshAllCaches(). A telemetry read must not write to the player's save. The
// underlying data is reachable read-only, so nothing is lost by going round
// them: SpaceCenterManagement.LCToEfficiency is a public field and this file
// looks the launch complex up in it directly, and the rates come off the private
// backing fields the getters would otherwise populate. See Rp1ScMath for the
// arithmetic those two facts make possible.
//
// LCOpsProject.GetTimeLeftEstAll() is out for a second reason on top of the
// first: it mutates three shared static scratch lists on RP-1's own type.
//
// The construction projects are out for their own reasons, which is why none of
//
//   ConstructionProject.GetBuildRate() / .GetTimeLeft() / .GetFractionComplete()
//   / .RemainingCost / .RushMultiplier / .KSC, FacilityUpgradeProject
//   .GetItemName(), PadConstructionProject.LC / .GetItemName()
//
// is called either. GetBuildRate writes _buildRate and reaches .KSC, which
// memoises a centre found by walking the whole roster; RemainingCost runs a
// CurrencyModifierQueryRP0 that broadcasts to every modifier in the save;
// RushMultiplier evaluates a HermiteCurve from a separate assembly whose body
// could not be read, so the throttle is published and the cost multiplier it
// buys is not; PadConstructionProject.LC memoises the same way GetBuildRate's
// centre does; and the two GetItemName overrides localise a facility name and
// walk to the complex respectively, where the stored `name` field answers
// already.
//
// WHAT IS CALLED, each with its body read on the shipped assembly:
//
//   LCLaunchPad.State          pure; reads its own destruction ConfigNode, its
//                              own isOperational, and its complex's rollout list
//   LaunchComplex.MaxEngineers pure arithmetic over massMax/sizeMax/isHumanRated
//   LaunchComplex.Rate         a plain `=> _rate` backing-field read
//   LCEfficiency.Efficiency    a plain `=> _efficiency` backing-field read
//   LCEfficiency.MaxEfficiency a plain `=> _MaxEfficiency` static read
//   LCEfficiency.PredictWeightedEfficiency
//                              pure: reads its own efficiency and some statics,
//                              evaluates a settings curve, writes only locals
//                              and its out parameter
//   LCOpsProject.IsBlocking / .IsReversed
//                              pure on both shipped implementations
//                              (ReconRolloutProject switches on RRType,
//                              VesselRepairProject inherits the base constants)
//
// ONE CALL REACHES CODE THIS FILE COULD NOT READ, and it is fenced accordingly.
// LCSpaceCenter.AssociatedGroundStation calls KSCSwitcherInterop
// .GetGroundStationForKSC, whose body IS read (it returns null outright when
// KSCSwitcher is absent, and memoises otherwise) but which then invokes
// KSCSwitcher's own GetSiteByName, and KSCSwitcher is not installed anywhere
// reachable. So it is called at most ONCE per centre name, its result memoised
// here as well, and a throw degrades that one field to absent.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// Resolves RP-1's space-centre model by reflection and reads one tick of it
    /// into <see cref="Rp1ScRaw"/>. Nothing in this file touches KSP or Unity, so
    /// it compiles and runs headless against a stand-in object graph.
    /// </summary>
    public sealed class Rp1ScReflection
    {
        private const string ScmTypeName = "RP0.SpaceCenterManagement";
        private const string ConfidenceTypeName = "RP0.Confidence";
        private const string EfficiencyTypeName = "RP0.LCEfficiency";
        private const string DatabaseTypeName = "RP0.Database";
        private const string MaintenanceTypeName = "RP0.MaintenanceHandler";

        /// <summary>The parameter type that tells the two salary overloads apart.</summary>
        private const string LaunchComplexTypeName = "RP0.LaunchComplex";

        /// <summary>Days in RP-1's year, the divisor its own salary arithmetic uses.</summary>
        private const double DaysPerYear = 365.25;

        private readonly Type? _scm;
        private readonly Type? _confidence;
        private readonly Type? _lcEfficiency;
        private readonly Type? _database;
        private readonly Type? _maintenance;

        /// <summary>Cached MethodInfo per (type, method): the one member kind read by invoke rather than by value.</summary>
        private readonly Dictionary<string, MemberInfo?> _methods = new Dictionary<string, MemberInfo?>();
        private readonly Dictionary<string, string?> _groundStations = new Dictionary<string, string?>();

        /// <summary>
        /// RP-1 is installed. Gated on the TYPE resolving, never on an assembly
        /// name: RP-1 historically shipped its construction-time fork under an
        /// assembly called <c>KerbalConstructionTime</c>, so a name match is not
        /// evidence that the types exist, and an Uplink that publishes
        /// <c>available: true</c> and then nothing is worse than one that says no.
        /// </summary>
        public bool IsAvailable => _scm != null;

        /// <summary>Whether RP-1's Confidence scenario module type resolved at all.</summary>
        public bool ConfidenceTypeResolved => _confidence != null;

        /// <summary>
        /// The assembly the space-centre type actually came from, as
        /// "<c>name, version</c>", for the health facts. Taken from the resolved
        /// TYPE rather than from a name scan, so it names the assembly that
        /// answered rather than one that merely matched.
        /// </summary>
        public string? AssemblyIdentity { get; }

        public Rp1ScReflection()
        {
            _scm = Rp1Types.Find(ScmTypeName);
            _confidence = Rp1Types.Find(ConfidenceTypeName);
            _lcEfficiency = Rp1Types.Find(EfficiencyTypeName);
            _database = Rp1Types.Find(DatabaseTypeName);
            _maintenance = Rp1Types.Find(MaintenanceTypeName);

            if (_scm != null)
            {
                try
                {
                    var name = _scm.Assembly.GetName();
                    AssemblyIdentity = name.Name + ", " + name.Version;
                }
                catch (Exception)
                {
                    // fail-soft: an unreadable assembly name is a missing health
                    // fact, never a missing Uplink
                }
            }
        }

        /// <summary>
        /// RP-1's scenario module is live and this save is one it manages. False
        /// on a stock install, in the main menu, and in a save started before
        /// RP-1 was added, which are three different reasons for the same empty
        /// answer and all of them mean "publish nothing".
        /// </summary>
        public bool IsEnabledForSave()
        {
            var instance = ScmInstance();
            return instance != null && ReadBool(instance, "enabledForSave") == true;
        }

        /// <summary>
        /// Whether the flight currently on screen is one of RP-1's SIMULATIONS
        /// rather than a real mission, or null when RP-1 cannot answer.
        ///
        /// <para>Null covers three cases that all mean "do not claim anything":
        /// RP-1 is not installed, its scenario module is not live (the main
        /// menu), or the save is not one RP-1 manages. None of them is
        /// "this is a real mission", and reporting false for them would let a
        /// consumer stamp a flight as confirmed on no evidence.</para>
        ///
        /// <para><c>SpaceCenterManagement.IsSimulatedFlight</c> is a public
        /// persisted bool field, set true when RP-1 starts a simulation and
        /// cleared when it ends. Read live rather than cached, the same
        /// discipline <see cref="IsEnabledForSave"/> follows and for the same
        /// reason: the callers are polled independently of any subscription, so
        /// there is no capture whose cadence a cache could ride.</para>
        /// </summary>
        public bool? IsSimulatedFlight()
        {
            var instance = ScmInstance();
            if (instance == null || ReadBool(instance, "enabledForSave") != true)
            {
                return null;
            }
            return ReadBool(instance, "IsSimulatedFlight");
        }

        /// <summary>
        /// Reads one tick. Always returns a payload: an unavailable RP-1 yields
        /// <see cref="Rp1ScRaw.Available"/> false and empty lists, which is the
        /// state the client needs in order to say so.
        /// </summary>
        public Rp1ScRaw Read(double ut)
        {
            var raw = new Rp1ScRaw { Ut = ut };
            var scm = ScmInstance();
            if (scm == null || ReadBool(scm, "enabledForSave") != true)
            {
                return raw;
            }
            raw.Available = true;

            var rushRateMult = ReadRushRateMult();
            var maxEfficiency = ReadMaxEfficiency();
            var lcToEfficiency = Member(scm, "LCToEfficiency") as IDictionary;
            var payroll = ReadPayroll(scm);

            var totalEngineers = 0;
            foreach (var ksc in Enumerate(Member(scm, "KSCs")))
            {
                var kscName = ReadString(ksc, "KSCName");
                var kscEngineers = ReadInt(ksc, "Engineers") ?? 0;
                totalEngineers += kscEngineers;

                var assignedEngineers = 0;
                var operationalCount = 0;
                var anyOperationalBeyondHangar = false;
                var lcIndex = 0;
                // Where this centre's complexes start, so its own upkeep can be
                // totalled off the rows just read rather than by asking RP-1 the
                // same question a second time.
                var firstComplex = raw.Complexes.Count;

                foreach (var lc in Enumerate(Member(ksc, "LaunchComplexes")))
                {
                    var lcEngineers = ReadInt(lc, "Engineers") ?? 0;
                    assignedEngineers += lcEngineers;
                    var operational = ReadBool(lc, "IsOperational") == true;
                    if (operational)
                    {
                        operationalCount++;
                        // Index 0 is always the hangar, and RP-1's own
                        // IsAnyLCOperational skips it: the question the flag
                        // answers is whether there is a pad-side complex to work
                        // with, not whether the centre exists.
                        if (lcIndex > 0)
                        {
                            anyOperationalBeyondHangar = true;
                        }
                    }
                    lcIndex++;

                    ReadComplex(raw, ksc, kscName, lc, lcEngineers, operational, lcToEfficiency, maxEfficiency, rushRateMult, payroll);
                }

                ReadConstructions(raw, kscName, ksc);

                raw.Centres.Add(new Rp1CentreRaw
                {
                    KscName = kscName,
                    IsActive = ReferenceEquals(ksc, Member(scm, "ActiveSC")),
                    Engineers = kscEngineers,
                    UnassignedEngineers = kscEngineers - assignedEngineers,
                    LaunchComplexCount = operationalCount,
                    AnyOperational = anyOperationalBeyondHangar,
                    GroundStation = GroundStationFor(ksc, kscName),
                    SalaryPerDay = SalaryPerDay(payroll, payroll.CentreSalary, ksc),
                    IdleSalaryPerDay = IdleSalaryPerDay(payroll, kscEngineers - assignedEngineers),
                    UpkeepPerDay = UpkeepFrom(raw.Complexes, firstComplex),
                });
            }

            ReadResearch(raw, scm);

            raw.Personnel = new Rp1PersonnelRaw
            {
                TotalEngineers = totalEngineers,
                Researchers = ReadInt(scm, "Researchers") ?? 0,
                Applicants = ReadInt(scm, "Applicants") ?? 0,
                EngineerSalaryPerDay = ReadDouble(payroll.Maintenance, "IntegrationSalaryPerDay"),
                ResearcherSalaryPerDay = ReadDouble(payroll.Maintenance, "ResearchSalaryPerDay"),
                EngineerSalaryPerYear = payroll.EngineerSalaryPerYear,
                ResearcherSalaryPerYear = ReadDouble(payroll.Settings, "salaryResearchers"),
                IdleSalaryMult = payroll.EngineerIdleSalaryMult,
            };

            raw.RushTerms = ReadRushTerms(payroll.Settings);
            raw.Confidence = ReadConfidence();
            return raw;
        }

        private void ReadComplex(
            Rp1ScRaw raw,
            object ksc,
            string? kscName,
            object lc,
            int engineers,
            bool operational,
            IDictionary? lcToEfficiency,
            double maxEfficiency,
            double rushRateMult,
            Payroll payroll)
        {
            var lcId = ReadGuidString(lc, "ID");
            var lcType = ReadEnumName(lc, "LCType");
            var isRushing = ReadBool(lc, "IsRushing") == true;
            var rushRate = isRushing ? rushRateMult : 1.0;

            // The hangar has no efficiency record of its own and RP-1 reads it as
            // the ceiling; every other complex is looked up, and a MISS is absent
            // rather than zero, because RP-1 builds the record the first time the
            // complex is worked and a crew nobody has rated is not a bad crew.
            var efficiencySource = lcType == "Hangar" ? null : Lookup(lcToEfficiency, lc);
            double? efficiency = lcType == "Hangar"
                ? maxEfficiency
                : efficiencySource == null ? (double?)null : ReadDouble(efficiencySource, "Efficiency");

            var maxEngineers = ReadInt(lc, "MaxEngineers") ?? 0;

            var reconRollout = Materialise(Member(lc, "Recon_Rollout"));
            var vesselRepairs = Materialise(Member(lc, "VesselRepairs"));
            var projectBpTotal = ProjectBpTotal(reconRollout, vesselRepairs);
            var canIntegrate = projectBpTotal == 0.0;

            var ramp = RampFor(efficiencySource, isRushing, engineers, maxEngineers, efficiency, maxEfficiency);
            var sizeMax = Member(lc, "SizeMax");

            raw.Complexes.Add(new Rp1ComplexRaw
            {
                KscName = kscName,
                LcId = lcId,
                Name = ReadString(lc, "Name"),
                LcType = lcType,
                IsOperational = operational,
                IsRushing = isRushing,
                Engineers = engineers,
                MaxEngineers = maxEngineers,
                Efficiency = efficiency,
                CanIntegrate = canIntegrate,
                Rate = ReadDouble(lc, "Rate"),
                HumanRated = ReadBool(lc, "IsHumanRated") == true,
                MassMin = ReadDouble(lc, "MassMin"),
                MassMax = UnlimitedAsAbsent(ReadDouble(lc, "MassMax")),
                SizeMaxHeight = SizeAxis(lc, "y"),
                SizeMaxWidth = SizeAxis(lc, "x"),
                SizeMaxDepth = SizeAxis(lc, "z"),
                ResourcesHandled = ReadResourcesHandled(lc),
                SalaryPerDay = SalaryPerDay(payroll, payroll.ComplexSalary, lc),
                UpkeepPerDay = ComplexUpkeep(payroll, lc),
                SizeMaxX = UnlimitedAsAbsent(ReadDouble(sizeMax, "x")),
                SizeMaxY = UnlimitedAsAbsent(ReadDouble(sizeMax, "y")),
                SizeMaxZ = UnlimitedAsAbsent(ReadDouble(sizeMax, "z")),
            });

            foreach (var vp in Enumerate(Member(lc, "BuildList")))
            {
                raw.BuildQueue.Add(ReadBuildItem(kscName, lcId, vp, efficiency, rushRate, canIntegrate, ramp, withProgress: true));
            }

            foreach (var vp in Enumerate(Member(lc, "Warehouse")))
            {
                var item = ReadBuildItem(kscName, lcId, vp, efficiency, rushRate, canIntegrate, ramp, withProgress: false);
                // Warehouse only. A vehicle still being integrated cannot roll
                // out for a reason that has nothing to do with its envelope, so
                // publishing envelope refusals against one would answer a
                // question nobody asked and read as the reason it cannot move.
                item.RolloutRefusals = RolloutRefusals(lc, vp);
                raw.Warehouse.Add(item);
            }

            // Pads under construction hang off the COMPLEX, unlike the other two
            // construction kinds, which hang off the centre. RP-1 files all three
            // into one per-centre list as well, and that merged list is not what
            // is walked here: it carries no kind and no owner, and both are what
            // makes a construction row legible.
            foreach (var pc in Enumerate(Member(lc, "PadConstructions")))
            {
                var row = ReadConstruction(kscName, pc, "Pad");
                row.LcId = lcId;
                row.PadId = ReadGuidString(pc, "id");
                raw.Constructions.Add(row);
            }

            foreach (var pad in Enumerate(Member(lc, "LaunchPads")))
            {
                var waiting = PadWaitingVessel(pad, out var waitingName);
                raw.Pads.Add(new Rp1PadRaw
                {
                    KscName = kscName,
                    LcId = lcId,
                    PadId = ReadGuidString(pad, "id"),
                    Name = ReadString(pad, "name"),
                    LaunchSiteName = ReadString(pad, "launchSiteName"),
                    Level = ReadInt(pad, "level") ?? 0,
                    FractionalLevel = NegativeAsAbsent(ReadDouble(pad, "fractionalLevel")),
                    State = ReadEnumName(pad, "State"),
                    HasVesselWaiting = waiting,
                    WaitingVesselName = waitingName,
                });
            }

            // The blocking set, gathered ONCE for the complex: every operation's
            // ETA depends on all the others, because they share the complex and
            // each one's share grows as its neighbours finish.
            //
            // Recon_Rollout only, and deliberately so even though the complex's
            // own blocking-BP total (above) counts vessel repairs as well. That
            // asymmetry is RP-1's: RecalculateProjectBP walks GetAllLCOps, while
            // GetTimeLeftEstAll walks Recon_Rollout alone. Mirroring RP-1 beats
            // being independently consistent.
            var blockingSet = new List<Rp1ScMath.BlockingOp>();
            var blockingOps = new List<object>();
            foreach (var op in reconRollout)
            {
                if (ReadBool(op, "IsBlocking") != true)
                {
                    continue;
                }
                var points = Math.Abs(ReadDouble(op, "BP") ?? 0.0);
                var progress = ReadDouble(op, "progress") ?? 0.0;
                var reversed = ReadBool(op, "IsReversed") == true;
                if (reversed ? progress <= 0.0 : progress >= points)
                {
                    continue;
                }
                var baseRate = ReadDouble(op, "_buildRate") ?? -1.0;
                blockingOps.Add(op);
                blockingSet.Add(new Rp1ScMath.BlockingOp
                {
                    Points = points,
                    Remaining = reversed ? progress : points - progress,
                    // Un-shared: the sequencing applies each project's share
                    // itself, and re-applying it here would square it.
                    Rate = baseRate < 0.0 || efficiency == null
                        ? 0.0
                        : baseRate * efficiency.Value * rushRate,
                });
            }

            foreach (var op in reconRollout)
            {
                raw.Operations.Add(ReadOperation(
                    kscName, lcId, op, efficiency, rushRate, projectBpTotal, ramp, blockingOps, blockingSet));
            }
        }

        /// <summary>
        /// The blocking set reordered with <paramref name="subjectIndex"/> first,
        /// which is the ordering <see cref="Rp1ScMath.SequencedTimeLeft"/> reads:
        /// RP-1 adds the subject before its neighbours and stops the moment the
        /// subject is next to finish.
        /// </summary>
        private static List<Rp1ScMath.BlockingOp> SubjectFirst(
            List<Rp1ScMath.BlockingOp> set,
            int subjectIndex)
        {
            var ordered = new List<Rp1ScMath.BlockingOp>(set.Count) { set[subjectIndex] };
            for (var i = 0; i < set.Count; i++)
            {
                if (i != subjectIndex)
                {
                    ordered.Add(set[i]);
                }
            }
            return ordered;
        }

        private Rp1BuildItemRaw ReadBuildItem(
            string? kscName,
            string? lcId,
            object vp,
            double? efficiency,
            double rushRate,
            bool canIntegrate,
            Func<double, double>? ramp,
            bool withProgress)
        {
            var item = new Rp1BuildItemRaw
            {
                Id = ReadString(vp, "KCTPersistentID"),
                // A Guid on the vehicle and its ToString() on the operation
                // referencing it, which is why this goes through the reader that
                // answers both rather than ReadString.
                ShipId = ReadGuidString(vp, "shipID"),
                KscName = kscName,
                LcId = lcId,
                ShipName = ReadString(vp, "shipName"),
                Cost = ReadDouble(vp, "cost") ?? 0.0,
                Mass = ReadDouble(vp, "mass") ?? 0.0,
                HumanRated = ReadBool(vp, "humanRated") == true,
                LaunchSite = ReadString(vp, "launchSite"),
                ProjectType = ReadEnumName(vp, "Type"),
            };

            if (!withProgress)
            {
                // A warehouse vehicle is finished. Progress, rate and an ETA are
                // absent rather than complete-looking numbers, because "how far
                // along" is not a question this row answers.
                return item;
            }

            item.Progress = ReadDouble(vp, "progress") ?? 0.0;
            item.TotalPoints = ReadDouble(vp, "buildPoints") ?? 0.0;
            item.ProgressRatio = Rp1ScMath.ProgressRatio(item.Progress, item.TotalPoints);

            var baseRate = ReadDouble(vp, "_buildRate") ?? -1.0;
            item.Rate = Rp1ScMath.VesselRate(baseRate, efficiency, rushRate, canIntegrate);
            item.Stalled = Rp1ScMath.IsStalled(item.Rate);
            item.TimeLeftSeconds = Ramped(
                Rp1ScMath.BaseTimeLeft(item.Progress, item.TotalPoints, item.Rate),
                ramp);
            return item;
        }

        private Rp1OperationRaw ReadOperation(
            string? kscName,
            string? lcId,
            object op,
            double? efficiency,
            double rushRate,
            double projectBpTotal,
            Func<double, double>? ramp,
            List<object> blockingOps,
            List<Rp1ScMath.BlockingOp> blockingSet)
        {
            var reversed = ReadBool(op, "IsReversed") == true;
            var blocking = ReadBool(op, "IsBlocking") == true;
            var totalPoints = ReadDouble(op, "BP") ?? 0.0;
            var progress = ReadDouble(op, "progress") ?? 0.0;
            var baseRate = ReadDouble(op, "_buildRate") ?? -1.0;

            var rate = Rp1ScMath.OperationRate(baseRate, efficiency, rushRate, reversed, blocking, totalPoints, projectBpTotal);

            // A blocking operation's ETA is a SEQUENCE, not a division: it shares
            // the complex with its neighbours and its share grows as each of them
            // finishes. The share division alone answers EARLY, and an optimistic
            // completion time is a correctness defect rather than a rounding one,
            // so when the sequence cannot be computed the ETA is absent and
            // BlockingPeers is what an operator reads instead.
            var subjectIndex = blockingOps.IndexOf(op);
            double? seconds;
            if (subjectIndex >= 0)
            {
                seconds = Rp1ScMath.SequencedTimeLeft(SubjectFirst(blockingSet, subjectIndex));
            }
            else
            {
                seconds = Rp1ScMath.BaseTimeLeft(progress, totalPoints, rate, reversed);
            }

            return new Rp1OperationRaw
            {
                KscName = kscName,
                LcId = lcId,
                LaunchPadId = ReadString(op, "launchPadID"),
                Type = ReadEnumName(op, "RRType"),
                Progress = progress,
                TotalPoints = totalPoints,
                ProgressRatio = Rp1ScMath.ProgressRatio(progress, totalPoints, reversed),
                Rate = rate,
                Stalled = Rp1ScMath.IsStalled(rate),
                TimeLeftSeconds = Ramped(seconds, ramp),
                BlockingPeers = subjectIndex >= 0 ? blockingSet.Count - 1 : 0,
                Cost = ReadDouble(op, "cost") ?? 0.0,
                AssociatedVesselId = EmptyAsAbsent(ReadString(op, "associatedID")),
            };
        }

        /// <summary>
        /// The two construction lists a centre owns. Pads are read per complex,
        /// in <see cref="ReadComplex"/>, because that is where RP-1 keeps them.
        /// </summary>
        private void ReadConstructions(Rp1ScRaw raw, string? kscName, object ksc)
        {
            foreach (var fu in Enumerate(Member(ksc, "FacilityUpgrades")))
            {
                var row = ReadConstruction(kscName, fu, "FacilityUpgrade");
                // The one kind whose FacilityType is a claim about a facility.
                // RP-1's base project answers LaunchPad for the other two as its
                // transaction category, and publishing that would tell an operator
                // a launch complex was a pad upgrade.
                row.FacilityType = ReadEnumName(fu, "FacilityType");
                row.CurrentLevel = ReadInt(fu, "currentLevel");
                row.TargetLevel = ReadInt(fu, "upgradeLevel");
                raw.Constructions.Add(row);
            }

            foreach (var lcc in Enumerate(Member(ksc, "LCConstructions")))
            {
                var row = ReadConstruction(kscName, lcc, "LaunchComplex");
                row.LcId = ReadGuidString(lcc, "lcID");
                row.IsModify = ReadBool(lcc, "isModify");
                row.EngineersToReadd = ReadInt(lcc, "engineersToReadd");
                raw.Constructions.Add(row);
            }
        }

        /// <summary>
        /// The fields every construction kind shares, off
        /// <c>ConstructionProject</c>. The per-kind fields are set by the caller,
        /// which is the one that knows what it is looking at.
        /// </summary>
        /// <remarks>
        /// <c>GetBuildRate()</c>, <c>GetTimeLeft()</c>, <c>GetFractionComplete()</c>
        /// and <c>RemainingCost</c> are all gone round, each for a reason this file
        /// applies everywhere else too. <c>GetBuildRate</c> writes its own
        /// <c>_buildRate</c> and memoises a centre reference found by walking the
        /// roster; <c>RemainingCost</c> runs a currency query that broadcasts to
        /// every modifier in the save; and the other two answer an infinity and a
        /// NaN on a project RP-1 has not costed.
        /// </remarks>
        private Rp1ConstructionRaw ReadConstruction(string? kscName, object project, string kind)
        {
            var progress = ReadDouble(project, "progress") ?? 0.0;
            var totalPoints = ReadDouble(project, "BP") ?? 0.0;
            var workRate = ReadDouble(project, "workRate") ?? 1.0;
            var rate = Rp1ScMath.ConstructionRate(ReadDouble(project, "_buildRate") ?? -1.0, workRate);

            return new Rp1ConstructionRaw
            {
                KscName = kscName,
                Kind = kind,
                Name = EmptyAsAbsent(ReadString(project, "name")),
                Progress = progress,
                TotalPoints = totalPoints,
                ProgressRatio = Rp1ScMath.ProgressRatio(progress, totalPoints),
                WorkRate = workRate,
                Rate = rate,
                Stalled = Rp1ScMath.IsStalled(rate),
                // No efficiency ramp: a construction has no crew to get better at
                // it, and RP-1's own estimate is the plain division.
                TimeLeftSeconds = Rp1ScMath.BaseTimeLeft(progress, totalPoints, rate),
                Cost = ReadDouble(project, "cost") ?? 0.0,
                SpentCost = ReadDouble(project, "spentCost") ?? 0.0,
                SpentRushCost = ReadDouble(project, "spentRushCost") ?? 0.0,
            };
        }

        private void ReadResearch(Rp1ScRaw raw, object scm)
        {
            foreach (var node in Enumerate(Member(scm, "TechList")))
            {
                var scienceCost = ReadInt(node, "scienceCost") ?? 0;
                var progress = ReadDouble(node, "progress") ?? 0.0;
                var workRate = ReadDouble(node, "workRate") ?? 1.0;
                var rate = Rp1ScMath.ResearchRate(ReadDouble(node, "_buildRate") ?? -1.0, workRate);

                raw.Research.Add(new Rp1ResearchRaw
                {
                    TechId = ReadString(node, "techID"),
                    TechName = ReadString(node, "techName"),
                    ScienceCost = scienceCost,
                    Progress = progress,
                    ProgressRatio = Rp1ScMath.ProgressRatio(progress, scienceCost),
                    WorkRate = workRate,
                    Rate = rate,
                    Stalled = Rp1ScMath.IsStalled(rate),
                    // No efficiency ramp: researchers do not have a launch
                    // complex's skill-up curve, and RP-1's own TimeLeft is the
                    // plain division.
                    TimeLeftSeconds = Rp1ScMath.BaseTimeLeft(progress, scienceCost, rate),
                    StartYear = NonPositiveAsAbsent(ReadInt(node, "startYear")),
                    EndYear = NonPositiveAsAbsent(ReadInt(node, "endYear")),
                });
            }
        }

        /// <summary>
        /// Confidence, or nothing. Probing the instance rather than reading
        /// <c>Confidence.CurrentConfidence</c> is the whole point: that property
        /// answers 0 when the module is absent, and a career that has spent its
        /// confidence genuinely sits at 0, so the getter cannot tell an operator
        /// which of the two they are looking at.
        /// </summary>
        private Rp1ConfidenceRaw? ReadConfidence()
        {
            if (_confidence == null)
            {
                return null;
            }
            var instance = Rp1Types.StaticValue(_confidence, "Instance");
            if (instance == null)
            {
                return null;
            }
            return new Rp1ConfidenceRaw
            {
                Confidence = ReadDouble(instance, "confidence") ?? 0.0,
                Earned = ReadDouble(instance, "confidenceEarned") ?? 0.0,
            };
        }

        /// <summary>
        /// The blocking work occupying a launch complex, mirroring
        /// <c>LaunchComplex.RecalculateProjectBP</c> line for line: the absolute
        /// build points of every blocking, incomplete operation across the
        /// rollout and repair queues, which are exactly what
        /// <c>GetAllLCOps()</c> enumerates. Zero means integration can proceed.
        /// </summary>
        private double ProjectBpTotal(List<object> reconRollout, List<object> vesselRepairs)
        {
            var total = 0.0;
            foreach (var op in reconRollout)
            {
                total += BlockingBp(op);
            }
            foreach (var op in vesselRepairs)
            {
                total += BlockingBp(op);
            }
            return total;
        }

        private double BlockingBp(object op)
        {
            if (ReadBool(op, "IsBlocking") != true)
            {
                return 0.0;
            }
            var bp = ReadDouble(op, "BP") ?? 0.0;
            var progress = ReadDouble(op, "progress") ?? 0.0;
            var reversed = ReadBool(op, "IsReversed") == true;
            var complete = reversed ? progress <= 0.0 : progress >= bp;
            return complete ? 0.0 : Math.Abs(bp);
        }

        /// <summary>
        /// Binds the efficiency ramp to one launch complex, or returns null when
        /// there is no efficiency record to ramp against. The delegate takes an
        /// un-ramped estimate in seconds and answers the ramped one;
        /// <see cref="Rp1ScMath.RampedTimeLeft"/> holds every condition under
        /// which the ramp is a no-op, so the caller does not have to.
        /// </summary>
        private Func<double, double>? RampFor(
            object? efficiencySource,
            bool isRushing,
            int engineers,
            int maxEngineers,
            double? efficiency,
            double maxEfficiency)
        {
            if (efficiencySource == null || efficiency == null || _lcEfficiency == null)
            {
                return null;
            }
            var predict = Method(_lcEfficiency, "PredictWeightedEfficiency");
            if (predict == null)
            {
                return null;
            }

            var portionEngineers = maxEngineers > 0 ? (double)engineers / maxEngineers : 0.0;
            var startingEfficiency = efficiency.Value;
            Func<double, double> weightedEfficiency = seconds =>
            {
                try
                {
                    // (isRushing, tdelta, portionEngineers, out newEff, startingEfficiency)
                    var args = new object?[] { isRushing, seconds, portionEngineers, null, startingEfficiency };
                    var result = predict.Invoke(efficiencySource, args);
                    return result is double d ? d : double.NaN;
                }
                catch (Exception)
                {
                    // A ramp that will not evaluate leaves the un-ramped estimate
                    // standing: too long, never absent and never invented.
                    return double.NaN;
                }
            };

            return baseSeconds => Rp1ScMath.RampedTimeLeft(
                baseSeconds,
                startingEfficiency,
                maxEfficiency,
                isRushing,
                engineers,
                maxEngineers,
                weightedEfficiency);
        }

        private static double? Ramped(double? baseSeconds, Func<double, double>? ramp)
        {
            if (baseSeconds == null || ramp == null)
            {
                return baseSeconds;
            }
            return ramp(baseSeconds.Value);
        }

        /// <summary>
        /// The money members, resolved once per tick and carried down to each
        /// complex.
        ///
        /// <para>RP-1 answers what a crew draws and what a complex costs through
        /// its own methods rather than through fields, so both are a call per
        /// complex and the four lookups behind them are worth hoisting out of the
        /// loop. Every field may be null and each one being null costs exactly the
        /// figure it feeds.</para>
        /// </summary>
        private sealed class Payroll
        {
            public object? Scm;
            public object? Maintenance;
            public object? Settings;

            /// <summary>One engineer's full year, the rate both salary figures scale.</summary>
            public double? EngineerSalaryPerYear;

            /// <summary>The fraction of full salary an engineer assigned to nothing draws.</summary>
            public double? EngineerIdleSalaryMult;

            /// <summary><c>GetEffectiveEngineersForSalary(LaunchComplex)</c>, by first-parameter type.</summary>
            public MethodInfo? ComplexSalary;

            /// <summary><c>GetEffectiveIntegrationEngineersForSalary(LCSpaceCenter)</c>.</summary>
            public MethodInfo? CentreSalary;

            /// <summary><c>MaintenanceHandler.LCUpkeep(LaunchComplex)</c>.</summary>
            public MethodInfo? ComplexUpkeep;
        }

        /// <summary>
        /// Resolves this tick's money members. The two salary lookups are keyed on
        /// their first parameter's TYPE and not on arity: RP-1 declares a centre
        /// overload of the same name and arity, and picking it would report a
        /// whole centre's payroll against one launch complex.
        /// </summary>
        private Payroll ReadPayroll(object scm)
        {
            var settings = _database == null ? null : Rp1Types.StaticValue(_database, "SettingsSC");
            var maintenance = _maintenance == null ? null : Rp1Types.StaticValue(_maintenance, "Instance");
            return new Payroll
            {
                Scm = scm,
                Maintenance = maintenance,
                Settings = settings,
                EngineerSalaryPerYear = ReadDouble(settings, "salaryEngineers"),
                EngineerIdleSalaryMult = ReadDouble(settings, "EngineerIdleSalaryMult"),
                ComplexSalary = Rp1Types.InstanceMethodOn(
                    scm, "GetEffectiveEngineersForSalary", LaunchComplexTypeName, 1),
                CentreSalary = Rp1Types.InstanceMethod(
                    scm, "GetEffectiveIntegrationEngineersForSalary", 1),
                ComplexUpkeep = maintenance == null
                    ? null
                    : Rp1Types.InstanceMethod(maintenance, "LCUpkeep", 1),
            };
        }

        /// <summary>
        /// What a crew draws per day, from RP-1's own effective headcount.
        ///
        /// <para>RP-1's method is CALLED rather than mirrored, unlike the rate
        /// arithmetic this file reproduces, and the two are different situations
        /// rather than an inconsistency. The rate helpers had to be gone round
        /// because they persist an efficiency record on a cache miss; these read
        /// their own lists and return a number, so calling them is both safe and
        /// the only way to get a figure that agrees with the one RP-1 bills. The
        /// ladder behind it is not arithmetic worth copying: an idle complex pays
        /// at a fraction, a rushing one pays double, and a human-rated complex
        /// building an uncrewed vehicle pays part of its crew at each rate.</para>
        /// </summary>
        private double? SalaryPerDay(Payroll payroll, MethodInfo? method, object subject)
        {
            if (method == null || payroll.Scm == null || payroll.EngineerSalaryPerYear == null)
            {
                return null;
            }
            var heads = InvokeForDouble(method, payroll.Scm, subject);
            return heads == null
                ? (double?)null
                : heads.Value * payroll.EngineerSalaryPerYear.Value / DaysPerYear;
        }

        /// <summary>
        /// The part of a centre's salary bill that buys no work: its unassigned
        /// engineers, at RP-1's idle fraction.
        ///
        /// <para>The one salary figure that is arithmetic here rather than an
        /// RP-1 call, because RP-1 has no method for it: it folds the idle pool
        /// into the centre total (<c>GetEffectiveIntegrationEngineersForSalary</c>
        /// adds <c>UnassignedEngineers * EngineerIdleSalaryMult</c> to the sum of
        /// its complexes) and never answers for the term on its own. The term is
        /// a product of two numbers RP-1 does publish, so it is reproduced rather
        /// than left to a client that would have to write RP-1's year length
        /// down.</para>
        /// </summary>
        private static double? IdleSalaryPerDay(Payroll payroll, int unassigned) =>
            payroll.EngineerIdleSalaryMult == null || payroll.EngineerSalaryPerYear == null
                ? (double?)null
                : unassigned
                    * payroll.EngineerIdleSalaryMult.Value
                    * payroll.EngineerSalaryPerYear.Value
                    / DaysPerYear;

        /// <summary>What the complex itself costs per day, crew aside.</summary>
        private double? ComplexUpkeep(Payroll payroll, object lc) =>
            payroll.ComplexUpkeep == null || payroll.Maintenance == null
                ? (double?)null
                : InvokeForDouble(payroll.ComplexUpkeep, payroll.Maintenance, lc);

        /// <summary>
        /// A one-argument RP-1 call that answers a number, or absent when it
        /// could not be made. Fenced because these reach RP-1 code across an
        /// assembly boundary this Uplink holds no reference to, and a capture
        /// that throws takes the whole tick's reading with it.
        /// </summary>
        private static double? InvokeForDouble(MethodInfo method, object target, object argument)
        {
            try
            {
                return Rp1Types.ToDouble(method.Invoke(target, new object[] { argument }));
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// A centre's own upkeep: its complexes' figures, summed off the rows just
        /// read. Absent when not one of them answered, rather than zero, because a
        /// centre whose costs could not be read has not been shown to be free.
        /// </summary>
        private static double? UpkeepFrom(List<Rp1ComplexRaw> complexes, int from)
        {
            var total = 0.0;
            var any = false;
            for (var i = from; i < complexes.Count; i++)
            {
                var upkeep = complexes[i].UpkeepPerDay;
                if (upkeep != null)
                {
                    total += upkeep.Value;
                    any = true;
                }
            }
            return any ? total : (double?)null;
        }

        /// <summary>
        /// One axis of a complex's size envelope, off the Vector3 RP-1 keeps it
        /// in. Unlimited reads as absent on the same rule the mass limit follows.
        /// </summary>
        private double? SizeAxis(object lc, string axis) =>
            UnlimitedAsAbsent(ReadDouble(Member(lc, "SizeMax"), axis));

        /// <summary>
        /// The resources a complex can load, sorted so a client's rendering does
        /// not move when RP-1's dictionary rehashes. Absent when RP-1 has no
        /// dictionary to read, which is a different answer from a complex that
        /// handles nothing.
        /// </summary>
        private static List<string>? ReadResourcesHandled(object lc)
        {
            if (!(Member(lc, "ResourcesHandled") is IDictionary handled))
            {
                return null;
            }
            var names = new List<string>();
            try
            {
                foreach (var key in handled.Keys)
                {
                    if (key is string name && name.Length > 0)
                    {
                        names.Add(name);
                    }
                }
            }
            catch (Exception)
            {
                return null;
            }
            names.Sort(StringComparer.Ordinal);
            return names;
        }

        /// <summary>
        /// What rushing costs, from RP-1's settings. Absent as a whole when the
        /// settings could not be read: a client that quotes a default multiplier
        /// is telling an operator a price nobody charged.
        /// </summary>
        private static Rp1RushTermsRaw? ReadRushTerms(object? settings)
        {
            if (settings == null)
            {
                return null;
            }
            var rate = Rp1Types.ReadDouble(settings, "RushRateMult");
            var salary = Rp1Types.ReadDouble(settings, "RushSalaryMult");
            return rate == null && salary == null
                ? null
                : new Rp1RushTermsRaw { RateMult = rate, SalaryMult = salary };
        }

        private double ReadRushRateMult()
        {
            if (_database == null)
            {
                return 1.0;
            }
            var settings = Rp1Types.StaticValue(_database, "SettingsSC");
            return settings == null ? 1.0 : ReadDouble(settings, "RushRateMult") ?? 1.0;
        }

        private double ReadMaxEfficiency()
        {
            if (_lcEfficiency == null)
            {
                return 1.0;
            }
            var value = Rp1Types.StaticValue(_lcEfficiency, "MaxEfficiency");
            return value is double d ? d : 1.0;
        }

        private object? ScmInstance() => _scm == null ? null : Rp1Types.StaticValue(_scm, "Instance");

        /// <summary>
        /// The centre's associated ground station, memoised per centre name. The
        /// one call in this file that reaches an assembly whose body could not be
        /// read; see this file's header for the fence around it.
        /// </summary>
        private string? GroundStationFor(object ksc, string? kscName)
        {
            var key = kscName ?? string.Empty;
            if (_groundStations.TryGetValue(key, out var cached))
            {
                return cached;
            }
            string? value = null;
            try
            {
                value = ReadString(ksc, "AssociatedGroundStation");
            }
            catch (Exception)
            {
                // fail-soft: an unreadable ground station is one absent field
            }
            _groundStations[key] = value;
            return value;
        }

        // ── Reflection primitives ────────────────────────────────────────────

        /// <summary>
        /// Reads a named property or field off an object's runtime type. Delegates
        /// to the shared primitive, which walks the base chain so a protected
        /// member declared on a base class (RP-1's <c>LCOpsProject._buildRate</c>)
        /// resolves from the concrete subclass.
        /// </summary>
        private static object? Member(object? target, string name) => Rp1Types.Member(target, name);

        private MethodInfo? Method(Type type, string name)
        {
            var key = type.FullName + "()." + name;
            if (!_methods.TryGetValue(key, out var member))
            {
                try
                {
                    member = type.GetMethod(name, BindingFlags.Public | BindingFlags.Instance);
                }
                catch (Exception)
                {
                    member = null;
                }
                _methods[key] = member;
            }
            return member as MethodInfo;
        }

        private double? ReadDouble(object? target, string name) => ToDouble(Member(target, name));

        private static double? ToDouble(object? value)
        {
            switch (value)
            {
                case double d: return d;
                case float f: return f;
                case int i: return i;
                case long l: return l;
                default: return null;
            }
        }

        private int? ReadInt(object? target, string name)
        {
            var value = Member(target, name);
            switch (value)
            {
                case int i: return i;
                case long l: return (int)l;
                case short s: return s;
                default: return null;
            }
        }

        private bool? ReadBool(object? target, string name) => Rp1Types.ReadBool(target, name);

        private string? ReadString(object? target, string name) => Rp1Types.ReadString(target, name);

        private string? ReadGuidString(object? target, string name) => Rp1Types.ReadGuidString(target, name);

        private string? ReadEnumName(object? target, string name) => Rp1Types.ReadEnumName(target, name);

        private static IEnumerable<object> Enumerate(object? collection) => Rp1Types.Enumerate(collection);

        private static List<object> Materialise(object? collection)
        {
            var list = new List<object>();
            foreach (var item in Enumerate(collection))
            {
                list.Add(item);
            }
            return list;
        }

        private static object? Lookup(IDictionary? map, object key)
        {
            if (map == null)
            {
                return null;
            }
            try
            {
                return map.Contains(key) ? map[key] : null;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>float.MaxValue is RP-1's "no limit" sentinel; a limit nobody has is not a number.</summary>
        private static double? UnlimitedAsAbsent(double? value) =>
            value == null || value.Value >= float.MaxValue ? (double?)null : value;

        private static double? NegativeAsAbsent(double? value) =>
            value == null || value.Value < 0.0 ? (double?)null : value;

        private static int? NonPositiveAsAbsent(int? value) =>
            value == null || value.Value <= 0 ? (int?)null : value;

        private static string? EmptyAsAbsent(string? value) =>
            string.IsNullOrEmpty(value) ? null : value;

        /// <summary>
        /// Whether a craft is standing on this pad in <c>PRELAUNCH</c>, and its
        /// name. Null when the question could not be asked, which is a different
        /// answer from false and is why this is a <c>bool?</c>.
        /// </summary>
        /// <remarks>
        /// The one member this capture INVOKES rather than reads, and it is worth
        /// saying why that is safe here when the file header forbids it generally.
        /// The rule the header sets is that a sampled read must not write to the
        /// player's save, and the objection to RP-1's display helpers is precise:
        /// they reach <c>LaunchComplex.Efficiency</c>, whose getter CONSTRUCTS and
        /// PERSISTS an <c>LCEfficiency</c> on a cache miss.
        ///
        /// <para><c>HasVesselWaitingToBeLaunched</c> has no such arm. Its whole
        /// body reads <c>lastLoadedVesselId</c>, asks
        /// <c>FlightGlobals.FindVessel</c> for it, and compares
        /// <c>vessel.situation</c> to <c>PRELAUNCH</c>. No memoisation, no
        /// construction, no assignment, so it is a read that happens to be spelled
        /// as a method.</para>
        ///
        /// <para>It cannot be reproduced from fields instead, which is why it is
        /// invoked at all: the answer lives on a <c>Vessel</c> in
        /// <c>FlightGlobals</c> rather than anywhere on the pad, and
        /// <c>LCLaunchPad.State</c> deliberately does not consult it. That is the
        /// gap this field exists to close.</para>
        /// </remarks>
        /// <summary>
        /// RP-1's own reasons this vehicle cannot leave its complex, or null when
        /// it has none.
        ///
        /// <para>REPRODUCED from fields, never invoked, and that is not a
        /// preference. <c>VesselProject.MeetsFacilityRequirements</c> calls
        /// <c>GetTotalMass</c>, <c>GetShipSize</c> and <c>HasClamps</c>, and each
        /// of those MEMOISES its answer onto the vehicle when the stored value is
        /// zero or untested. Those are <c>[Persistent]</c> fields, so invoking it
        /// from a sampled capture would have a telemetry read edit the player's
        /// save, which the file header forbids outright. The command invokes it
        /// instead, because a command runs at the moment of a press and is exactly
        /// where RP-1's own button calls it.</para>
        ///
        /// <para><b>The comparison itself is no longer written here.</b> It lives
        /// in <see cref="Rp1Envelope"/>, which this hands measurements to, because
        /// a craft FILE needs the same arithmetic against measurements that come
        /// from a file rather than from a vehicle and a third copy was not worth
        /// having. <see cref="Rp1LaunchGate"/> still carries its own: it is
        /// load-bearing for every launch and its inputs are live objects rather
        /// than numbers, and a test that runs one fixture through both and asserts
        /// they agree is what keeps the two honest; see
        /// <c>Rp1RolloutEligibilityTests</c>.</para>
        ///
        /// <para>A zero mass or a zero size axis is a figure nobody wrote down
        /// rather than a vehicle of no extent, and the getter that would compute
        /// one is the memoising one above. No figure, no comparison: an invented
        /// one would refuse a real vehicle.</para>
        /// </summary>
        private string[]? RolloutRefusals(object lc, object vp)
        {
            var reasons = new List<string>();

            if (ReadBool(vp, "AllPartsValid") == false)
            {
                // RP-1 omits the whole row for such a vehicle, so an operator
                // gets no explanation from the game's own window either.
                reasons.Add("some of its parts are not present in this install");
            }

            var size = Member(vp, "ShipSize");
            var limit = Member(lc, "SizeMax");
            reasons.AddRange(Rp1Envelope.Refusals(
                mass: ReadDouble(vp, "mass"),
                sizeX: ReadDouble(size, "x"),
                sizeY: ReadDouble(size, "y"),
                sizeZ: ReadDouble(size, "z"),
                humanRated: ReadBool(vp, "humanRated"),
                // Not asked, and its absence permits. A vehicle in a warehouse
                // stands at the complex that integrated it, which already
                // accepted whatever clamps it has, and the only reading that
                // would answer memoises onto the save.
                hasClamps: null,
                lcMassMin: ReadDouble(lc, "MassMin"),
                lcMassMax: UnlimitedAsAbsent(ReadDouble(lc, "MassMax")),
                lcSizeX: UnlimitedAsAbsent(ReadDouble(limit, "x")),
                lcSizeY: UnlimitedAsAbsent(ReadDouble(limit, "y")),
                lcSizeZ: UnlimitedAsAbsent(ReadDouble(limit, "z")),
                lcHumanRated: ReadBool(lc, "IsHumanRated"),
                lcType: ReadEnumName(lc, "LCType")));

            return reasons.Count == 0 ? null : reasons.ToArray();
        }

        private bool? PadWaitingVessel(object pad, out string? vesselName)
        {
            vesselName = null;
            try
            {
                var check = Rp1Types.InstanceMethod(pad, "HasVesselWaitingToBeLaunched", 1);
                if (check == null)
                {
                    return null;
                }
                var arguments = new object?[1];
                if (!(check.Invoke(pad, arguments) is bool waiting))
                {
                    return null;
                }
                if (waiting)
                {
                    vesselName = EmptyAsAbsent(ReadString(arguments[0], "vesselName"));
                }
                return waiting;
            }
            catch (Exception)
            {
                // Absent rather than false: an unreadable answer must not read as
                // "the pad is clear", because the client would then offer a pad
                // the command can only refuse.
                return null;
            }
        }
    }
}
