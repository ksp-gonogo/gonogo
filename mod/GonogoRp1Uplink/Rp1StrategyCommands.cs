// Committing to a strategy from outside the Administration Building.
//
// WHAT WAS WRONG. On a live RP-1 career the console lists 97 strategies (60
// leader configs plus 37 generated program ones) and can appoint NONE of them:
// every entry carries canActivate absent with "KSP answers this only while the
// Administration Building is open". That is honest, and it is the whole feature
// missing. Stock's Strategy.CanBeActivated dereferences Administration.Instance
// in its first statement, Strategy.Activate calls CanBeActivated, so both throw
// with the screen shut.
//
// WHAT THIS DOES INSTEAD. StrategyRP0.ActivateOverride is gate-plus-procedure
// and nothing else, and PerformActivate is public, non-virtual and never asks
// CanBeActivated. So we ask the arms that do not need the screen, then call the
// procedure. The UI-dependent arm is never asked rather than answered, and
// nothing here reproduces a rule the game would have applied.
//
// See Rp1StrategyWrites for the rule this obeys, the reason the program half is
// hoisted rather than bypassed, and the provenance of every member.
//
// THE TWO ARMS WE CANNOT ASK, and why that is honest rather than a hole:
//
//   Arm 1 is the concurrent-strategy cap, and it is the one the screen owns.
//   Under RP-1 it is a DEAD ARM for leaders: PatchStrategy zeroes the count
//   stock compares, precisely so leaders are exempt, and the real cap for
//   programs lives at arm 8 which we DO ask. Under stock it is a live rule we
//   cannot evaluate, so a stock career refuses with that named as the reason
//   rather than being guessed at.
//
//   Arm 3 is the commit-level ceiling. GameVariables.GetStrategyCommitRange is
//   the same method Administration.Start reads it from and is public and
//   VIRTUAL, so calling through GameVariables.Instance inherits a retiering
//   mod's override where reimplementing the thresholds would not. We ask it.
//
// EVERY OTHER ARM IS THE GAME'S OWN. Conflicts, the three affordability checks,
// the reputation floor, the strategy's own CanActivate and each effect's
// CanActivate are all invoked on the live objects. Arm 9 in particular executes
// third-party code, so a throw there refuses rather than proceeding: an
// unanswerable question leaves the commitment unmade.
using System;
using System.Collections.Generic;
using System.Reflection;
using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// <c>rp1.strategy.activate</c>: commit to a leader or a program without the
    /// Administration Building.
    /// </summary>
    public sealed class Rp1StrategyCommands
    {
        /// <summary>Commit to a strategy, leader or program alike.</summary>
        public const string ActivateCommand = "rp1.strategy.activate";

        private const string ScmTypeName = "RP0.SpaceCenterManagement";

        private readonly Type? _scm;
        private readonly Type? _strategyRp0;
        private readonly Type? _programStrategy;
        private readonly Type? _programHandler;

        public Rp1StrategyCommands()
        {
            _scm = Rp1Types.Find(ScmTypeName);
            _strategyRp0 = Rp1Types.Find(Rp1StrategyWrites.StrategyRp0TypeName);
            _programStrategy = Rp1Types.Find(Rp1StrategyWrites.ProgramStrategyTypeName);
            _programHandler = Rp1Types.Find(Rp1StrategyWrites.ProgramHandlerTypeName);
        }

        /// <summary>
        /// The command can run: RP-1's space centre and its three strategy types
        /// resolved.
        ///
        /// <para>TYPES ONLY, for the reason
        /// <see cref="Rp1PersonnelCommands.IsAvailable"/> spells out: a
        /// method-level gate on the manifest cannot say why it fired, because a
        /// command that was never declared looks exactly like one nobody wrote.
        /// The method lookups happen at the press and refuse with a sentence
        /// naming what was not recognised.</para>
        /// </summary>
        public bool IsAvailable =>
            _scm != null && _strategyRp0 != null && _programStrategy != null && _programHandler != null;

        /// <summary>
        /// Whether the members this command invokes resolved, as a sentence for a
        /// health fact.
        /// </summary>
        public string MethodDiagnosis()
        {
            if (!IsAvailable) return "RP-1 strategy types not found";
            var scm = _scm == null ? null : Rp1Types.StaticValue(_scm, "Instance");
            if (scm == null) return "RP-1 space centre is not loaded; activation will refuse at the press";
            return "every resolved type is present; member lookups happen at the press";
        }

        /// <summary>
        /// Commit to the named strategy.
        ///
        /// <para>NOT a set. Activation is a one-way act that spends a currency and
        /// starts a tenure, so a repeat is refused rather than treated as already
        /// satisfied, unlike <c>rp1.personnel.assign</c>.</para>
        /// </summary>
        public CommandResult Activate(Rp1StrategyActivateArgs? args)
        {
            var id = args?.StrategyId;
            if (string.IsNullOrWhiteSpace(id))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound, "no strategy was named");
            }
            if (!IsAvailable)
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable, "RP-1 strategy types are not present");
            }

            var system = StrategySystemInstance();
            if (system == null)
            {
                return CommandResult.Fail(CommandErrorCode.CareerModeRequired, "there is no strategy system");
            }

            if (!TryFindStrategy(system, id!, out var strategy))
            {
                return CommandResult.Fail(CommandErrorCode.NotFound, $"no strategy is named \"{id}\"");
            }
            if (Rp1Types.ReadBool(strategy, "IsActive") == true)
            {
                return CommandResult.Fail(CommandErrorCode.WrongState, "the strategy is already active");
            }

            /*
             * Precondition: the singletons PerformActivate dereferences without a
             * guard, checked BEFORE anything is written and refused on rather than
             * discovered. PerformActivate calls RecalculateBuildRates() and
             * OnLeaderChange() AFTER isActive, Register() and the currency charge,
             * so a null there is a half-completed activation and no refusal to
             * restore from. This is what makes the command safe in a scene we have
             * not tested: we decline to enter a procedure whose preconditions we
             * cannot see hold, rather than needing to know which scenes hold them.
             */
            var scm = _scm == null ? null : Rp1Types.StaticValue(_scm, "Instance");
            if (scm == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.NotClearToProceed,
                    "RP-1's space centre is not loaded, and committing needs it to recalculate build rates");
            }
            var handler = _programHandler == null ? null : Rp1Types.StaticValue(_programHandler, "Instance");
            if (handler == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.NotClearToProceed,
                    "RP-1's program handler is not loaded, and committing needs it to record the change");
            }

            var isProgram = Rp1StrategyWrites.IsProgramStrategy(strategy, _programStrategy);

            /*
             * Read, never assumed. With the screen open PerformActivate's own
             * Register() performs the program half itself, so performing it here
             * as well accepts twice: two Accept()s, two Confidence charges, a
             * duplicate ActivePrograms entry and a restarted funding schedule. The
             * remote console is exactly the case where the screen may be open.
             *
             * Absent is not false. A flag we could not read leaves us unable to
             * tell which half the game will perform, and guessing either way risks
             * a double charge or a program that is active but never accepted.
             */
            var inAdmin = Rp1StrategyWrites.IsInAdmin(handler);
            if (isProgram && inAdmin == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.NotClearToProceed,
                    "cannot tell whether the Administration Building is open, and a program would be accepted twice if it is");
            }

            var gate = Refusal(system, strategy, args?.Factor);
            if (gate != null) return gate;

            return Commit(strategy, handler, isProgram, inAdmin == true, args?.Factor);
        }

        /// <summary>
        /// The arms of <c>CanBeActivated</c> that do not need the Administration
        /// screen, asked on the live objects rather than reproduced.
        /// </summary>
        /// <remarks>
        /// Returns the refusal, or null to proceed. A throw anywhere here refuses:
        /// arms 8 and 9 execute third-party code, and an unanswerable question
        /// must leave the commitment unmade rather than fall through to a spend.
        /// </remarks>
        private CommandResult? Refusal(object system, object strategy, double? factor)
        {
            try
            {
                var conflicts = Invoke(system, "HasConflictingActiveStrategies", 1, Rp1Types.Member(strategy, "GroupTags"));
                if (conflicts is bool clash && clash)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.NotClearToProceed,
                        "another active strategy conflicts with this one");
                }

                var ceiling = CommitCeiling();
                var wanted = factor ?? Rp1Types.ReadDouble(strategy, "Factor") ?? 0.0;
                if (ceiling != null && wanted > ceiling.Value)
                {
                    return CommandResult.Fail(
                        CommandErrorCode.NotClearToProceed,
                        $"the Administration Building allows a commitment of at most {ceiling.Value * 100.0:0.#}%");
                }

                var reason = StrategyRefusal(strategy);
                if (reason != null)
                {
                    return CommandResult.Fail(CommandErrorCode.NotClearToProceed, reason);
                }
            }
            catch (Exception ex)
            {
                return CommandResult.Fail(
                    CommandErrorCode.NotClearToProceed,
                    "RP-1 threw while judging eligibility: " + Rp1Types.ExceptionReason(ex));
            }
            return null;
        }

        /// <summary>
        /// The strategy's own <c>CanActivate</c>, which is arm 8 and where RP-1
        /// puts the real program slot cap, plus each effect's, which is arm 9.
        /// </summary>
        /// <remarks>
        /// Arm 8 is the reason a program is gated at all off-screen: RP-1's
        /// <c>ProgramStrategy.CanActivate</c> checks
        /// <c>MaxProgramSlots - ActiveProgramSlots</c> and needs no
        /// <c>Administration</c>. Skipping it would move the corrupted-career risk
        /// rather than remove it.
        /// </remarks>
        private static string? StrategyRefusal(object strategy)
        {
            var refusal = AskCanActivate(strategy);
            if (refusal != null) return refusal;

            /*
             * Arm 9, and it is open-ended: StrategyEffect.CanActivate is virtual,
             * so any mod's effect can refuse for a reason we cannot enumerate. We
             * ask each one rather than reproducing what they check.
             *
             * The semantics are "refuse if ANY effect refuses". Worth stating,
             * because the decompiler renders this loop INVERTED: its C# reads
             * `if (effects[i].CanActivate(ref reason)) return false;`, i.e.
             * refuse when an effect says it CAN. The IL disagrees. At IL_02ac the
             * callvirt is followed by `brtrue.s` continuing the loop, and the
             * fall-through is `ldc.i4.0; ret`. KSP ships a control-flow
             * obfuscator whose dead switch blocks break branch reconstruction,
             * and it inverted this loop while getting the sibling call twelve
             * lines earlier right.
             */
            foreach (var effect in Rp1Types.Enumerate(Rp1Types.Member(strategy, "Effects")))
            {
                var said = AskCanActivate(effect);
                if (said != null) return said;
            }
            return null;
        }

        /// <summary>
        /// One <c>CanActivate(ref string)</c> call, on a strategy or on one of
        /// its effects, returning the game's own words or null to proceed.
        /// </summary>
        private static string? AskCanActivate(object? target)
        {
            if (target == null) return null;
            var method = Rp1Types.InstanceMethod(target, "CanActivate", 1);
            if (method == null) return null;
            var argv = new object?[] { "" };
            var ok = method.Invoke(target, argv);
            if (ok is bool allowed && !allowed)
            {
                var said = argv[0] as string;
                return string.IsNullOrWhiteSpace(said) ? "RP-1 refused the commitment" : said!;
            }
            return null;
        }

        /// <summary>
        /// <c>GameVariables.GetStrategyCommitRange</c> at the Administration
        /// Building's level: arm 3's ceiling, from the source
        /// <c>Administration.Start</c> caches rather than from the screen.
        /// </summary>
        /// <remarks>
        /// Null when it cannot be read, which skips the arm rather than refusing:
        /// the ceiling is a ceiling, and the strategy's own default factor is
        /// already inside it. A commitment ABOVE it is refused by arm 8 or by the
        /// game at the next opportunity.
        /// </remarks>
        private static double? CommitCeiling()
        {
            var vars = GameVariablesInstance();
            if (vars == null) return null;
            var level = AdministrationLevel();
            if (level == null) return null;
            var method = Rp1Types.InstanceMethod(vars, "GetStrategyCommitRange", 1);
            return method == null ? null : Rp1Types.ToDouble(method.Invoke(vars, new object?[] { level.Value }));
        }

        private static object? GameVariablesInstance()
        {
            var t = Rp1Types.Find("GameVariables");
            return t == null ? null : Rp1Types.StaticValue(t, "Instance");
        }

        private static float? AdministrationLevel()
        {
            var t = Rp1Types.Find("ScenarioUpgradeableFacilities");
            if (t == null) return null;
            var facility = Rp1Types.Find("SpaceCenterFacility");
            if (facility == null) return null;
            var admin = Enum.Parse(facility, "Administration");
            var method = Rp1Types.StaticMethod(t, "GetFacilityLevel", 1);
            var value = method?.Invoke(null, new[] { admin });
            return value is float f ? f : (float?)null;
        }

        /// <summary>
        /// The commitment itself, in the order the in-screen path performs it.
        /// </summary>
        /// <remarks>
        /// <para><b>The program half runs FIRST.</b> In-screen, ActivateProgram
        /// runs inside Register(), which is step 2 of PerformActivate, before its
        /// alarm block. That block mints a KAC alarm from
        /// <c>programStrategy.Program.deadlineUT</c>, and Accept() assigns
        /// deadlineUT on the instance it RETURNS rather than on the template. So
        /// performing PerformActivate first leaves the template in place and the
        /// alarm is created at UT 0, silently, with nothing thrown.</para>
        ///
        /// <para><b>And only when the game will not perform it itself.</b> With
        /// the Administration screen open, Register()'s own OnRegister does the
        /// program half, so doing it here as well accepts twice.</para>
        ///
        /// <para><b>Factor is written before the gate and restored on a
        /// refusal</b>, because Strategy.Factor is a plain persisted setter: a
        /// refused activation that left it written would change the commitment
        /// level on the save with nothing to show for it.</para>
        /// </remarks>
        private CommandResult Commit(object strategy, object handler, bool isProgram, bool inAdmin, double? factor)
        {
            var previous = Rp1Types.ReadDouble(strategy, "Factor");
            if (factor.HasValue && !Rp1Types.WriteDouble(strategy, "Factor", factor.Value))
            {
                return CommandResult.Fail(CommandErrorCode.ModeUnavailable, "RP-1 would not take a commitment level");
            }

            try
            {
                if (isProgram && !inAdmin)
                {
                    var program = Rp1StrategyWrites.Program(strategy);
                    if (program == null)
                    {
                        Restore(strategy, factor, previous);
                        return CommandResult.Fail(CommandErrorCode.WrongState, "the program this strategy carries could not be read");
                    }
                    var activate = Rp1StrategyWrites.ActivateProgram(handler);
                    if (activate == null)
                    {
                        Restore(strategy, factor, previous);
                        return CommandResult.Fail(
                            CommandErrorCode.ModeUnavailable,
                            "RP-1's ProgramHandler.ActivateProgram(Program) was not recognised");
                    }
                    activate.Invoke(handler, new[] { program });
                }

                var perform = Rp1StrategyWrites.PerformActivate(strategy);
                if (perform == null)
                {
                    Restore(strategy, factor, previous);
                    return CommandResult.Fail(
                        CommandErrorCode.ModeUnavailable,
                        "RP-1's StrategyRP0.PerformActivate(bool) was not recognised");
                }
                perform.Invoke(strategy, new object?[] { true });
            }
            catch (Exception ex)
            {
                /*
                 * No restore here, deliberately. Past the first invoke the game
                 * may hold state we did not write and cannot unwind, so putting
                 * Factor back would describe a rollback that did not happen. Say
                 * what was attempted instead.
                 */
                return CommandResult.Fail(
                    CommandErrorCode.Unknown,
                    "RP-1 threw while committing, and the career may be part-way through it: "
                        + Rp1Types.ExceptionReason(ex));
            }

            return CommandResult.Ok();
        }

        private static void Restore(object strategy, double? factor, double? previous)
        {
            if (factor.HasValue && previous.HasValue)
            {
                Rp1Types.WriteDouble(strategy, "Factor", previous.Value);
            }
        }

        private static object? StrategySystemInstance()
        {
            var t = Rp1Types.Find("Strategies.StrategySystem");
            return t == null ? null : Rp1Types.StaticValue(t, "Instance");
        }

        private static bool TryFindStrategy(object system, string id, out object strategy)
        {
            foreach (var candidate in Rp1Types.Enumerate(Rp1Types.Member(system, "Strategies")))
            {
                var name = Rp1Types.ReadString(candidate, "Name") ?? Rp1Types.ReadString(candidate, "Config");
                if (string.Equals(name, id, StringComparison.OrdinalIgnoreCase))
                {
                    strategy = candidate;
                    return true;
                }
            }
            strategy = null!;
            return false;
        }

        private static object? Invoke(object target, string name, int arity, params object?[] argv)
        {
            var method = Rp1Types.InstanceMethod(target, name, arity);
            return method?.Invoke(target, argv);
        }
    }
}
