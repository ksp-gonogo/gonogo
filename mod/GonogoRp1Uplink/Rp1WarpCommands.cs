// Warping to something RP-1 is waiting for: the next project to finish, or the
// balance a fund target is aiming at.
//
// WHAT WAS WRONG WITHOUT IT. RP-1's whole career loop is waiting: a vehicle
// integrates for weeks, a tech node researches for months, a complex renovates,
// a fund target accumulates. An operator could read every one of those and its
// ETA from this Uplink, and then had to step the warp ladder by hand and watch
// for the moment to stop. RP-1 does it properly and stops on the exact frame; a
// human stepping a ladder does not.
//
// TWO COMMANDS, NOT THREE, and dropping the third is the decision worth reading.
// FJ's G5 asks for "warp to fund target, warp to complete, stop warp". There is
// no rp1.warp.stop here, because RP-1's controller stops ITSELF: its FixedUpdate
// reads TimeWarp.CurrentRateIndex and a zero branches straight to
// DestroyGameObject (IL_002c `brtrue.s IL_003f`, else IL_002f-IL_003e). So
// core's own time.setWarpIndex(0) already ends an RP-1 warp, the WarpControl
// widget's existing "1x" button already sends it, and a second command would be
// two controls doing one thing with the operator left to guess which one RP-1
// respects. It respects both. Checked at IL rather than in the decompiler
// precisely because it is being used to REMOVE scope.
//
// WHAT IS INVOKED:
//
//   KCTWarpController.Create(ISpaceCenterProject)
//                                    ARITY ONE, and its argument is nullable with
//                                    a MEANING: null means "the next thing to
//                                    finish", anything else means that project.
//                                    RP-1's own warp-to-complete button passes
//                                    null, and its per-project buttons pass the
//                                    project
//   KCTUtilities.GetNextThingToFinish()
//                                    asked BEFORE Create, which is the whole of
//                                    the guard below
//
// RP-1's OWN Create THROWS on an empty career, and this is the finding that shapes
// the first command. Create assigns the target and then logs
// `warpTarget.GetItemName()` with no null check, and GetNextThingToFinish returns
// null both when ActiveSC is null and when nothing anywhere is in progress. RP-1
// never hits it because its button is drawn inside a branch that already has a
// non-null next-thing (the else arm renders "No Active Projects"), so the
// NullReferenceException is latent and reachable only by a caller that does not
// check. Worse, Create has already done `new GameObject` and `AddComponent` by
// then, so the throw leaves a KCTWarpController attached with a null target.
// Asking GetNextThingToFinish ourselves first is not defensive tidiness, it is the
// difference between a refusal and a wrecked scene.
//
// THE SCENE MATTERS, and RP-1 says so twice. Its controller's FixedUpdate returns
// early unless the scene is flight, the space centre or the tracking station, and
// its own buttons are drawn only outside the editor. A warp started anywhere else
// would create a controller that never ticks: it would set a warp rate and then
// never step it down, which is worse than not warping at all because it overshoots
// the thing it was aimed at. Declared as a REQUIREMENT so the control is dark with
// its reason rather than answering a press with a wasted warp.
//
// WHAT IS NOT HERE. Warping to a NAMED project, which RP-1 offers a button for on
// every row of its build list. Not because it is hard (it is the same Create call
// with the project instead of null) but because it is a different act: "warp until
// this particular thing is done" needs the thing addressed on the wire, and the
// projects an operator would name are spread across rp1.buildQueue,
// rp1.constructions, rp1.research and rp1.training with four different id shapes.
// Worth doing and not worth guessing at.
//
// PROVENANCE. Every member named above was read out of an ilspycmd disassembly of
// the INSTALLED RP-1 v4.6.0.0 RP0.dll, and the self-destruct on rate zero
// additionally out of its IL. The disassembly verifies SHAPE and never VALUE:
// nothing here has been exercised against a running game, so every hop is
// null-safe and every failure to read refuses the command rather than guessing at
// it.
using System;
using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// The handlers for <c>rp1.warp.toComplete</c> and
    /// <c>rp1.warp.toFundTarget</c>.
    /// </summary>
    public sealed class Rp1WarpCommands : ICommandGateEvaluator
    {
        /// <summary>Warp until the career's next project finishes.</summary>
        public const string ToCompleteCommand = "rp1.warp.toComplete";

        /// <summary>Warp until the balance reaches the standing fund target.</summary>
        public const string ToFundTargetCommand = "rp1.warp.toFundTarget";

        /// <summary>
        /// The scenes RP-1's warp controller actually ticks in, as a gate kind a
        /// client can read before the press.
        /// </summary>
        public const string GateKind = "rp1.warp";

        /// <summary>The one quantity this gate answers.</summary>
        public const string WarpableScene = "warpableScene";

        private const string WrongSceneDetail =
            "RP-1 only steps warp down at the space centre, the tracking station or in flight";

        /// <summary>
        /// The requirement to declare on both commands, so the control is drawn
        /// dark with its reason in the editor rather than only answering the press.
        /// </summary>
        /// <remarks>
        /// No <see cref="CommandRequirement.Needs"/>: the engine decides it with an
        /// empty argument bag, because which scene the game is in does not depend on
        /// what the operator is warping toward.
        /// </remarks>
        public static CommandRequirement SceneRequirement() =>
            new CommandRequirement { Kind = GateKind, Quantity = WarpableScene };

        public string Kind => GateKind;

        /// <summary>
        /// Whether the game is in a scene RP-1's warp controller ticks in.
        /// </summary>
        /// <remarks>
        /// The scene IS the thing here, unlike the facility gate beside it, and
        /// that is not a lapse: RP-1's own <c>FixedUpdate</c> compares
        /// <c>HighLogic.LoadedScene</c> against exactly these three, so the scene is
        /// the condition rather than a proxy for one.
        /// </remarks>
        public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
        {
            var quantity = requirement?.Quantity ?? "";
            if (quantity != WarpableScene)
            {
                return GateVerdict.Unknown($"RP-1 imposes no warp condition called \"{quantity}\"");
            }

            return InAWarpableScene()
                ? GateVerdict.Pass()
                : GateVerdict.Fail(CommandErrorCode.WrongScene, WrongSceneDetail);
        }

        private const string ScmTypeName = "RP0.SpaceCenterManagement";
        private const string WarpControllerTypeName = "RP0.KCTWarpController";
        private const string UtilitiesTypeName = "RP0.KCTUtilities";
        private const string HighLogicTypeName = "HighLogic";

        private readonly Type? _scm;
        private readonly Type? _warpController;
        private readonly Type? _utilities;
        private readonly Type? _highLogic;

        public Rp1WarpCommands()
        {
            _scm = Rp1Types.Find(ScmTypeName);
            _warpController = Rp1Types.Find(WarpControllerTypeName);
            _utilities = Rp1Types.Find(UtilitiesTypeName);
            _highLogic = Rp1Types.Find(HighLogicTypeName);
        }

        /// <summary>
        /// Both commands can run: RP-1's space centre, its warp controller and its
        /// static helpers resolved.
        ///
        /// <para>TYPES ONLY, for the reason
        /// <see cref="Rp1VehicleCommands.IsAvailable"/> spells out at length: a
        /// method-level gate on the MANIFEST cannot say why it fired, because a
        /// command that was never declared looks exactly like one nobody wrote.
        /// The method lookups happen at the press and refuse with a sentence
        /// naming what was not recognised.</para>
        ///
        /// <para><see cref="_highLogic"/> is deliberately NOT part of this: it
        /// answers which SCENE the game is in, and an install where KSP's own
        /// HighLogic could not be found has problems a withheld warp command would
        /// not help with. The scene gate below fails open for the same reason.</para>
        /// </summary>
        public bool IsAvailable => _scm != null && _warpController != null && _utilities != null;

        /// <summary>
        /// Whether the members these commands invoke resolved, as a sentence for a
        /// health fact. The same reasoning as
        /// <see cref="Rp1VehicleCommands.MethodDiagnosis"/>.
        /// </summary>
        public string MethodDiagnosis()
        {
            if (!IsAvailable)
            {
                return "RP-1 warp types not found";
            }
            try
            {
                if (Rp1Types.StaticMethod(_warpController!, "Create", 1) == null)
                {
                    return "warping will refuse at the press: KCTWarpController.Create(ISpaceCenterProject) not found";
                }
                if (Rp1Types.StaticMethod(_utilities!, "GetNextThingToFinish", 0) == null)
                {
                    // Named separately because losing THIS one is what would make a
                    // warp-to-complete crash rather than refuse: it is the guard, not
                    // the action.
                    return "warping will refuse at the press: KCTUtilities.GetNextThingToFinish() not found, "
                        + "and without it a warp with nothing to warp to would throw inside RP-1";
                }
            }
            catch (Exception ex)
            {
                // Runs from Health, on the Courier thread. A diagnostic that takes
                // the health surface down with it is worse than no diagnostic.
                return "warping will refuse at the press: member lookup threw: " + Rp1Types.ExceptionReason(ex);
            }
            return "every invoked member resolved";
        }

        /// <summary>
        /// The scene condition, evaluable before the press.
        ///
        /// <para>RP-1's warp controller ticks in flight, at the space centre and at
        /// the tracking station, and nowhere else. Started elsewhere it would set a
        /// warp rate and then never step it down, overshooting the thing it was
        /// aimed at, which is worse than not warping.</para>
        ///
        /// <para>FAILS OPEN when KSP's own scene cannot be read: a gate that cannot
        /// answer must not withhold a command RP-1 would have accepted, and the
        /// handler asks again at the press.</para>
        /// </summary>
        public bool InAWarpableScene()
        {
            if (_highLogic == null)
            {
                return true;
            }

            if (Rp1Types.StaticValue(_highLogic, "LoadedSceneIsFlight") is true)
            {
                return true;
            }

            // KSP's GameScenes ordinals: SPACECENTER is 5 and TRACKSTATION is 8,
            // read as integers because this assembly has no such enum. The two
            // values are RP-1's own, from the same comparison its FixedUpdate makes.
            var scene = Rp1Types.StaticValue(_highLogic, "LoadedScene");
            if (scene == null)
            {
                return true;
            }
            try
            {
                var ordinal = Convert.ToInt32(scene);
                return ordinal == 5 || ordinal == 8;
            }
            catch (Exception)
            {
                return true;
            }
        }

        /// <summary>
        /// Warps until the career's next project finishes, whichever it is.
        ///
        /// <para>RP-1 recomputes that target every frame, so a warp started here
        /// follows the queue: if a shorter project overtakes the one it was aimed
        /// at, RP-1 re-aims rather than overshooting.</para>
        /// </summary>
        public CommandResult ToComplete(Rp1WarpArgs? args)
        {
            if (!TryReady(out var refusal))
            {
                return refusal!;
            }

            var next = NextThingToFinish();
            if (next == null)
            {
                // THE GUARD, and it is not tidiness: RP-1's own Create dereferences
                // this without checking, having already attached its controller.
                // See this file's header.
                return CommandResult.Fail(
                    CommandErrorCode.NotFound,
                    "RP-1 has no project in progress, so there is nothing to warp to");
            }

            var name = ItemName(next) ?? "the next project";
            return Warp(next, "warp to " + name);
        }

        /// <summary>
        /// Warps until the balance reaches the standing fund target.
        ///
        /// <para>The target itself is set and cancelled elsewhere
        /// (<c>rp1.fundTarget.set</c>, <c>rp1.fundTarget.cancel</c>) and published
        /// on <c>rp1.fundTarget</c>. This is the warp half only, which is why it
        /// takes no figure: warping toward a balance nobody has committed to would
        /// be a different act with a different consequence.</para>
        /// </summary>
        public CommandResult ToFundTarget(Rp1WarpArgs? args)
        {
            if (!TryReady(out var refusal))
            {
                return refusal!;
            }

            var scm = Rp1Types.StaticValue(_scm!, "Instance");
            var target = Rp1Types.Member(scm, "fundTarget");
            if (target == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 would not say whether a fund target is standing, so nothing was warped");
            }

            // RP-1's own validity test, and it is not merely "non-zero": a figure
            // equal to the balance it was set at is no target at all, and one at or
            // below zero is not either.
            if (Rp1Types.ReadBool(target, "IsValid") != true)
            {
                return CommandResult.Fail(
                    CommandErrorCode.NotFound,
                    "no fund target is standing, so there is no balance to warp toward. "
                    + "Set one first with rp1.fundTarget.set");
            }

            return Warp(target, "warp to the fund target");
        }

        // ── Shared resolution ─────────────────────────────────────────────────

        /// <summary>
        /// The four refusals both commands share: this Uplink's own resolution,
        /// RP-1's scenario module, the save, and the scene.
        /// </summary>
        private bool TryReady(out CommandResult? refusal)
        {
            if (!IsAvailable)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1's warp model could not be resolved, so nothing was warped");
                return false;
            }

            var scm = Rp1Types.StaticValue(_scm!, "Instance");
            if (scm == null)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1's space centre is not loaded");
                return false;
            }

            if (Rp1Types.ReadBool(scm, "enabledForSave") != true)
            {
                refusal = CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 is not managing this save");
                return false;
            }

            if (!InAWarpableScene())
            {
                // Asked again here rather than trusted from the declared gate: a
                // scene can change between a control being drawn and a command
                // arriving, and this one arrives across a delay-aware dispatch.
                refusal = CommandResult.Fail(
                    CommandErrorCode.WrongScene,
                    WrongSceneDetail + ", so a warp started here would overshoot");
                return false;
            }

            refusal = null;
            return true;
        }

        /// <summary>
        /// Hands a target to RP-1's warp controller.
        ///
        /// <para>A THROW here is reported as a warp that may have started, not as a
        /// plain refusal. <c>Create</c> attaches its controller to a fresh
        /// GameObject before it does anything else, so a failure part-way can leave
        /// the game warping under a controller this Uplink cannot see, and an
        /// operator who read "refused" would not think to stop it.</para>
        /// </summary>
        private CommandResult Warp(object target, string what)
        {
            var create = Rp1Types.StaticMethod(_warpController!, "Create", 1);
            if (create == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "this RP-1 build has no warp controller this Uplink recognises, so nothing was warped");
            }

            try
            {
                create.Invoke(null, new[] { target });
            }
            catch (Exception ex)
            {
                return CommandResult.Fail(
                    CommandErrorCode.ModeUnavailable,
                    "RP-1 failed part-way through starting a " + what
                    + ", so check the warp rate before retrying: " + Rp1Types.ExceptionReason(ex));
            }

            return CommandResult.Ok();
        }

        /// <summary>
        /// RP-1's own answer to "what finishes next", across every centre and every
        /// kind of project.
        /// </summary>
        /// <returns>
        /// Null both when RP-1 has no active space centre and when nothing anywhere
        /// is in progress, which are the two states <c>Create</c> cannot survive.
        /// </returns>
        private object? NextThingToFinish()
        {
            var next = Rp1Types.StaticMethod(_utilities!, "GetNextThingToFinish", 0);
            if (next == null)
            {
                return null;
            }
            try
            {
                return next.Invoke(null, Array.Empty<object>());
            }
            catch (Exception)
            {
                // An unanswerable question is the same as no project, and for the
                // same reason: the only thing this answer gates is whether Create
                // would be handed a null.
                return null;
            }
        }

        /// <summary>What RP-1 calls a project, for the refusal sentence, or absent when it will not say.</summary>
        private static string? ItemName(object project)
        {
            try
            {
                return Rp1Types.InstanceMethod(project, "GetItemName", 0)
                    ?.Invoke(project, Array.Empty<object>()) as string;
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
