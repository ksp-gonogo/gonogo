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

        private readonly Type? _scm;
        private readonly Type? _confidence;
        private readonly Type? _lcEfficiency;
        private readonly Type? _database;

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

                    ReadComplex(raw, ksc, kscName, lc, lcEngineers, operational, lcToEfficiency, maxEfficiency, rushRateMult);
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
                });
            }

            ReadResearch(raw, scm);

            raw.Personnel = new Rp1PersonnelRaw
            {
                TotalEngineers = totalEngineers,
                Researchers = ReadInt(scm, "Researchers") ?? 0,
                Applicants = ReadInt(scm, "Applicants") ?? 0,
            };

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
            double rushRateMult)
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
            });

            foreach (var vp in Enumerate(Member(lc, "BuildList")))
            {
                raw.BuildQueue.Add(ReadBuildItem(kscName, lcId, vp, efficiency, rushRate, canIntegrate, ramp, withProgress: true));
            }

            foreach (var vp in Enumerate(Member(lc, "Warehouse")))
            {
                raw.Warehouse.Add(ReadBuildItem(kscName, lcId, vp, efficiency, rushRate, canIntegrate, ramp, withProgress: false));
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

    }
}
