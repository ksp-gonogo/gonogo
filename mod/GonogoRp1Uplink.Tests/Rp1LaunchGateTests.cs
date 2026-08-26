using System;
using System.Collections.Generic;
using System.Linq;
using GonogoRp1Uplink;
using RP0;
using Sitrep.Contract;
using Xunit;

namespace GonogoRp1Uplink.Tests
{
    /// <summary>
    /// RP-1's launch rules, run against the stand-in object graph.
    ///
    /// <para>The case that matters is the first one. Dispatched against a live
    /// RP-1 career, <c>ksp.launch { shipName: "V-2" }</c> answered
    /// <c>{"success":true}</c> and put a vessel on the pad with an empty build
    /// queue, no launch complex occupied and funds unchanged at 15,000. Every
    /// stock launch test passed on the way, because a V-2 is within all of them.
    /// What was missing was any question about whether the vehicle existed as a
    /// built article, and that is what these exercise.</para>
    ///
    /// <para>What this cannot do is stated in <c>Rp0Fixture</c>'s own header and
    /// applies unchanged: it proves the walk reads the members it claims to and
    /// derives what RP-1's arithmetic says, and nothing whatever about the values
    /// a running RP-1 would hold.</para>
    /// </summary>
    public class Rp1LaunchGateTests : IDisposable
    {
        private readonly Rp1LaunchGate _gate = new Rp1LaunchGate();

        public Rp1LaunchGateTests()
        {
            SpaceCenterManagement.Instance = null;
        }

        public void Dispose() => SpaceCenterManagement.Instance = null;

        /// <summary>The launch a dispatch actually carried.</summary>
        private sealed class Args : IGateArguments
        {
            private readonly Dictionary<string, object> _values = new Dictionary<string, object>(StringComparer.Ordinal);

            public static Args Of(string? shipName = "V-2", string? facility = "VAB", string? site = "LaunchPad")
            {
                var args = new Args();
                if (shipName != null) args._values["shipName"] = shipName;
                if (facility != null) args._values["facility"] = facility;
                if (site != null) args._values["site"] = site;
                return args;
            }

            public bool TryGet(string path, out object value) => _values.TryGetValue(path, out value!);
        }

        /// <summary>One space centre with one launch complex, built up per test.</summary>
        private static LaunchComplex Centre(LaunchComplexType type = LaunchComplexType.Pad)
        {
            var lc = new LaunchComplex { Name = "LC-1", LcTypeValue = type };
            if (type == LaunchComplexType.Pad)
            {
                lc.LaunchPads.Add(new LCLaunchPad { name = "Pad A" });
            }
            var ksc = new LCSpaceCenter { KSCName = "Cape Canaveral" };
            ksc.LaunchComplexes.Add(lc);
            SpaceCenterManagement.Instance = new SpaceCenterManagement { ActiveSC = ksc };
            SpaceCenterManagement.Instance.KSCs.Add(ksc);
            return lc;
        }

        private static VesselProject Vehicle(string name = "V-2", float mass = 13f) => new VesselProject
        {
            shipName = name,
            mass = mass,
            Type = ProjectType.VAB,
        };

        private static ReconRolloutProject Rollout(
            VesselProject vp,
            ReconRolloutProject.RolloutReconType type = ReconRolloutProject.RolloutReconType.Rollout,
            double progress = 100.0,
            double bp = 100.0,
            string pad = "Pad A") => new ReconRolloutProject
        {
            associatedID = vp.shipID.ToString(),
            RRType = type,
            launchPadID = pad,
            progress = progress,
            BP = bp,
        };

        private GateVerdict Ask(string quantity, IGateArguments? args = null) =>
            _gate.Evaluate(
                new CommandRequirement { Kind = Rp1LaunchGate.GateKind, Quantity = quantity },
                args ?? Args.Of());

        private GateVerdict AskAll(IGateArguments? args = null)
        {
            foreach (var requirement in Rp1LaunchGate.Requirements())
            {
                var verdict = Ask(requirement.Quantity, args);
                if (verdict.Outcome != GateOutcome.Pass) return verdict;
            }
            return GateVerdict.Pass();
        }

        // ── The bug, reproduced ────────────────────────────────────────────────

        /// <summary>
        /// The V-2 case. A career with launch complexes and an empty build queue
        /// refuses a launch of a vehicle nobody ever integrated, and says which
        /// of the two states it is in.
        /// </summary>
        [Fact]
        public void AVehicleNobodyBuiltIsRefused()
        {
            Centre();

            var verdict = AskAll();

            Assert.Equal(GateOutcome.Fail, verdict.Outcome);
            Assert.Equal(CommandErrorCode.NotReady, verdict.ErrorCode);
            Assert.Contains("V-2", verdict.Detail);
            Assert.Contains("has been built", verdict.Detail);
        }

        /// <summary>
        /// A vehicle mid-integration is a WAIT, not a job to start, and the two
        /// sentences differ so an operator does the right thing about each.
        /// </summary>
        [Fact]
        public void AVehicleStillIntegratingIsRefusedAsAWait()
        {
            var lc = Centre();
            lc.BuildList.Add(Vehicle());

            var verdict = Ask(Rp1LaunchGate.Integrated);

            Assert.Equal(CommandErrorCode.NotReady, verdict.ErrorCode);
            Assert.Contains("still being integrated at LC-1", verdict.Detail);
        }

        /// <summary>
        /// A finished vehicle nobody rolled out is refused by the second rule
        /// rather than the first, so the refusal names the step that is missing.
        /// </summary>
        [Fact]
        public void AFinishedVehicleThatWasNeverRolledOutIsRefused()
        {
            var lc = Centre();
            lc.Warehouse.Add(Vehicle());

            Assert.Equal(GateOutcome.Pass, Ask(Rp1LaunchGate.Integrated).Outcome);

            var verdict = Ask(Rp1LaunchGate.RolledOut);
            Assert.Equal(CommandErrorCode.NotReady, verdict.ErrorCode);
            Assert.Contains("has not been rolled out", verdict.Detail);
        }

        /// <summary>The whole set passes only once the vehicle is built and standing on a pad.</summary>
        [Fact]
        public void AnIntegratedAndRolledOutVehicleLaunches()
        {
            var lc = Centre();
            var vp = Vehicle();
            lc.Warehouse.Add(vp);
            lc.Recon_Rollout.Add(Rollout(vp));

            Assert.Equal(GateOutcome.Pass, AskAll().Outcome);
        }

        // ── Rollout, in its intermediate states ────────────────────────────────

        [Fact]
        public void ARolloutInProgressIsRefused()
        {
            var lc = Centre();
            var vp = Vehicle();
            lc.Warehouse.Add(vp);
            lc.Recon_Rollout.Add(Rollout(vp, progress: 40.0));

            var verdict = Ask(Rp1LaunchGate.RolledOut);

            Assert.Equal(CommandErrorCode.NotReady, verdict.ErrorCode);
            Assert.Contains("still rolling out to pad \"Pad A\"", verdict.Detail);
        }

        /// <summary>
        /// A rollback counts DOWN to zero, which is what
        /// <c>LCOpsProject.IsComplete</c> does with a reversed operation, so a
        /// rollback at full progress is one that has barely started.
        /// </summary>
        [Fact]
        public void ARollbackInProgressIsRefused()
        {
            var lc = Centre();
            var vp = Vehicle();
            lc.Warehouse.Add(vp);
            lc.Recon_Rollout.Add(
                Rollout(vp, ReconRolloutProject.RolloutReconType.Rollback, progress: 100.0));

            var verdict = Ask(Rp1LaunchGate.RolledOut);

            Assert.Equal(CommandErrorCode.NotReady, verdict.ErrorCode);
            Assert.Contains("rolling back", verdict.Detail);
        }

        /// <summary>
        /// A rollout belonging to a DIFFERENT vehicle does not launch this one.
        /// RP-1 associates the operation by the vehicle's shipID, and matching on
        /// the pad alone would fly whatever happened to be standing there.
        /// </summary>
        [Fact]
        public void AnotherVehiclesRolloutDoesNotCount()
        {
            var lc = Centre();
            var mine = Vehicle();
            var theirs = Vehicle("Sputnik");
            lc.Warehouse.Add(mine);
            lc.Warehouse.Add(theirs);
            lc.Recon_Rollout.Add(Rollout(theirs));

            var verdict = Ask(Rp1LaunchGate.RolledOut);

            Assert.Equal(CommandErrorCode.NotReady, verdict.ErrorCode);
            Assert.Contains("has not been rolled out", verdict.Detail);
        }

        [Fact]
        public void ADestroyedPadIsAFacilityRefusalRatherThanAReadinessOne()
        {
            var lc = Centre();
            var vp = Vehicle();
            lc.Warehouse.Add(vp);
            lc.Recon_Rollout.Add(Rollout(vp));
            lc.LaunchPads[0].DestroyedValue = true;

            var verdict = Ask(Rp1LaunchGate.RolledOut);

            Assert.Equal(CommandErrorCode.FacilityDamaged, verdict.ErrorCode);
            Assert.Contains("needs repairs", verdict.Detail);
        }

        [Fact]
        public void APadBeingReconditionedIsRefused()
        {
            var lc = Centre();
            var vp = Vehicle();
            lc.Warehouse.Add(vp);
            lc.Recon_Rollout.Add(Rollout(vp));
            lc.Recon_Rollout.Add(new ReconRolloutProject
            {
                RRType = ReconRolloutProject.RolloutReconType.Reconditioning,
                launchPadID = "Pad A",
                progress = 10.0,
                BP = 100.0,
            });

            var verdict = Ask(Rp1LaunchGate.RolledOut);

            Assert.Equal(CommandErrorCode.NotReady, verdict.ErrorCode);
            Assert.Contains("reconditioned", verdict.Detail);
        }

        [Fact]
        public void AComplexUnderReconstructionIsRefused()
        {
            var lc = Centre();
            var vp = Vehicle();
            lc.Warehouse.Add(vp);
            lc.Recon_Rollout.Add(Rollout(vp));
            lc.IsOperational = false;

            var verdict = Ask(Rp1LaunchGate.RolledOut);

            Assert.Equal(CommandErrorCode.NotReady, verdict.ErrorCode);
            Assert.Contains("still being reconstructed", verdict.Detail);
        }

        /// <summary>
        /// A hangar vehicle taxis out. RP-1's own hangar branch draws Launch with
        /// no rollout at all, so requiring one here would refuse every plane in
        /// the game.
        /// </summary>
        [Fact]
        public void AHangarVehicleNeedsNoRollout()
        {
            var lc = Centre(LaunchComplexType.Hangar);
            lc.Warehouse.Add(Vehicle("Bell X-1"));

            Assert.Equal(
                GateOutcome.Pass,
                AskAll(Args.Of("Bell X-1", facility: "SPH", site: "Runway")).Outcome);
        }

        // ── The complex's own envelope, which is NOT the pad's tier ────────────

        /// <summary>
        /// RP-1 measures a vehicle against its LAUNCH COMPLEX, not the pad tier
        /// stock's own tests read. It does not patch
        /// <c>GameVariables.GetCraftMassLimit</c>, it only calls it, so nothing
        /// else in this mod asks the question this rule asks.
        /// </summary>
        [Fact]
        public void AVehicleOverTheComplexsMassCeilingIsRefusedWithTheNumbers()
        {
            var lc = Centre();
            lc.MassMaxValue = 18f;
            var vp = Vehicle(mass: 24f);
            lc.Warehouse.Add(vp);
            lc.Recon_Rollout.Add(Rollout(vp));

            var verdict = AskAll();

            Assert.Equal(CommandErrorCode.LimitReached, verdict.ErrorCode);
            Assert.NotNull(verdict.Breach);
            Assert.Equal("mass", verdict.Breach!.Quantity);
            Assert.Equal(18.0, verdict.Breach.Limit);
            Assert.Equal(24.0, verdict.Breach.Actual);
            Assert.Equal("LC-1", verdict.Breach.FacilityName);
        }

        /// <summary>
        /// RP-1's mass FLOOR, which stock has no concept of at all: a complex
        /// built for a Saturn V cannot usefully integrate a sounding rocket.
        /// </summary>
        [Fact]
        public void AVehicleUnderTheComplexsMassFloorIsRefused()
        {
            var lc = Centre();
            lc.MassMinValue = 50f;
            var vp = Vehicle(mass: 13f);
            lc.Warehouse.Add(vp);
            lc.Recon_Rollout.Add(Rollout(vp));

            var verdict = AskAll();

            Assert.Equal(CommandErrorCode.LimitReached, verdict.ErrorCode);
            Assert.Contains("too light for LC-1", verdict.Detail);
        }

        [Fact]
        public void AVehicleOverTheComplexsSizeOnOneAxisIsRefused()
        {
            var lc = Centre();
            lc.SizeMaxValue = new UnityEngine.Vector3(10f, 40f, 10f);
            var vp = Vehicle();
            vp.ShipSize = new UnityEngine.Vector3(4f, 60f, 4f);
            lc.Warehouse.Add(vp);
            lc.Recon_Rollout.Add(Rollout(vp));

            var verdict = AskAll();

            Assert.Equal(CommandErrorCode.LimitReached, verdict.ErrorCode);
            Assert.Contains("too large for LC-1 on its y axis", verdict.Detail);
        }

        /// <summary>
        /// A size nobody recorded is not a vehicle of no size. The getter that
        /// would compute one writes to the vehicle, so the field is read raw and
        /// a zero means the comparison is not available.
        /// </summary>
        [Fact]
        public void AnUnrecordedSizeIsNotComparedAtAll()
        {
            var lc = Centre();
            lc.SizeMaxValue = new UnityEngine.Vector3(1f, 1f, 1f);
            var vp = Vehicle();
            lc.Warehouse.Add(vp);
            lc.Recon_Rollout.Add(Rollout(vp));

            Assert.Equal(GateOutcome.Pass, AskAll().Outcome);
        }

        /// <summary>Human rating, which stock also has no concept of.</summary>
        [Fact]
        public void AHumanRatedVehicleNeedsAHumanRatedComplex()
        {
            var lc = Centre();
            lc.HumanRatedValue = false;
            var vp = Vehicle();
            vp.humanRated = true;
            lc.Warehouse.Add(vp);
            lc.Recon_Rollout.Add(Rollout(vp));

            var verdict = AskAll();

            Assert.Equal(CommandErrorCode.CapabilityMismatch, verdict.ErrorCode);
            Assert.Contains("human-rated", verdict.Detail);
        }

        [Fact]
        public void ClampsCannotLaunchFromAHangar()
        {
            var lc = Centre(LaunchComplexType.Hangar);
            var vp = Vehicle("Bell X-1");
            vp.clampState = VesselProject.ClampsState.HasClamps;
            lc.Warehouse.Add(vp);

            var verdict = AskAll(Args.Of("Bell X-1", facility: "SPH", site: "Runway"));

            Assert.Equal(CommandErrorCode.CapabilityMismatch, verdict.ErrorCode);
            Assert.Contains("launch clamps", verdict.Detail);
        }

        /// <summary>
        /// A complex with no ceiling stores <c>float.MaxValue</c>, and 3.4e38
        /// beside a craft mass is not "unlimited", it is a bug that reads as a
        /// units error. The absence of a limit is the absence of a comparison.
        /// </summary>
        [Fact]
        public void AnUnlimitedComplexRefusesNothingOnMass()
        {
            var lc = Centre();
            lc.MassMaxValue = float.MaxValue;
            var vp = Vehicle(mass: 3000f);
            lc.Warehouse.Add(vp);
            lc.Recon_Rollout.Add(Rollout(vp));

            Assert.Equal(GateOutcome.Pass, AskAll().Outcome);
        }

        // ── Which complex answers ──────────────────────────────────────────────

        /// <summary>
        /// A plane in the hangar does not answer for a rocket of the same name.
        /// The command names the editor the craft was saved from, and RP-1 keeps
        /// rockets and planes in different kinds of complex.
        /// </summary>
        [Fact]
        public void AHangarVehicleDoesNotAnswerForAVabLaunch()
        {
            var hangar = Centre(LaunchComplexType.Hangar);
            hangar.Warehouse.Add(Vehicle());

            var verdict = Ask(Rp1LaunchGate.Integrated, Args.Of("V-2", facility: "VAB"));

            Assert.Equal(CommandErrorCode.NotReady, verdict.ErrorCode);
        }

        /// <summary>
        /// A finished copy wins over one still on a build list, wherever they
        /// sit: RP-1 lets the same design be queued again while a finished one
        /// stands ready, and refusing the ready one would be wrong.
        /// </summary>
        [Fact]
        public void AFinishedCopyWinsOverOneStillBuilding()
        {
            var lc = Centre();
            lc.BuildList.Add(Vehicle());
            var ready = Vehicle();
            lc.Warehouse.Add(ready);
            lc.Recon_Rollout.Add(Rollout(ready));

            Assert.Equal(GateOutcome.Pass, AskAll().Outcome);
        }

        // ── Not knowing, which is never a pass ─────────────────────────────────

        /// <summary>
        /// RP-1 installed and its scenario module not there is a scene that has
        /// not finished coming up, which is a read that FAILED. Unknown refuses
        /// the dispatch and leaves the control live; a Pass here would fly the
        /// unbuilt vehicle during every scene load.
        /// </summary>
        [Fact]
        public void NoSpaceCentreLoadedIsUnknown()
        {
            var verdict = Ask(Rp1LaunchGate.Integrated);

            Assert.Equal(GateOutcome.Unknown, verdict.Outcome);
            Assert.Contains("not loaded", verdict.Detail);
        }

        /// <summary>
        /// A save RP-1 does not manage has no build economy to step around, and
        /// that is a fact about the save rather than a read that failed. Passing
        /// is the truthful answer, and it is what keeps a stock career on an
        /// RP-1 install working exactly as it did.
        /// </summary>
        [Fact]
        public void ASaveRp1DoesNotManagePassesEverything()
        {
            Centre();
            SpaceCenterManagement.Instance!.enabledForSave = false;

            Assert.Equal(GateOutcome.Pass, AskAll().Outcome);
        }

        [Fact]
        public void ARequirementRp1DoesNotUnderstandIsUnknown()
        {
            Centre();

            var verdict = Ask("somethingElse");

            Assert.Equal(GateOutcome.Unknown, verdict.Outcome);
        }

        [Fact]
        public void ALaunchWithNoCraftNamedIsUnknownRatherThanPermitted()
        {
            Centre();

            var verdict = Ask(Rp1LaunchGate.Integrated, Args.Of(shipName: null));

            Assert.Equal(GateOutcome.Unknown, verdict.Outcome);
        }

        // ── What gets contributed ──────────────────────────────────────────────

        /// <summary>
        /// Every contributed requirement names the argument it cannot do without,
        /// so the engine abstains for the addressability sample instead of
        /// reaching an evaluator that would have to invent a vehicle. Abstain
        /// leaves the control live; core's own requirements still darken it when
        /// the pad is occupied.
        /// </summary>
        [Fact]
        public void EveryContributedRequirementNeedsTheShipName()
        {
            var requirements = Rp1LaunchGate.Requirements().ToList();

            Assert.Equal(3, requirements.Count);
            Assert.All(requirements, r => Assert.Equal(new[] { "shipName" }, r.Needs));
            Assert.All(requirements, r => Assert.Equal(Rp1LaunchGate.GateKind, r.Kind));
        }

        /// <summary>
        /// Integration is asked first, then the envelope, then the rollout. RP-1
        /// will not roll out a vehicle that fails its complex's limits, so a
        /// rollout refusal on one that is simply too heavy would name the wrong
        /// problem, and "it has not been rolled out" is a confusing thing to say
        /// about a vehicle nobody built.
        /// </summary>
        [Fact]
        public void TheRequirementsAreContributedInTheOrderTheyShouldBeAsked()
        {
            Assert.Equal(
                new[] { Rp1LaunchGate.Integrated, Rp1LaunchGate.WithinComplexLimits, Rp1LaunchGate.RolledOut },
                Rp1LaunchGate.Requirements().Select(r => r.Quantity).ToArray());
        }
    }
}
