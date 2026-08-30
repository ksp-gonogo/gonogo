// The RP-1 members a strategy activation needs from outside the Administration
// Building, in one place, because every one of them is a thing that goes wrong
// quietly.
//
// WHY THIS EXISTS. Stock's Strategy.CanBeActivated dereferences
// Administration.Instance in its FIRST statement, and that is a UI MonoBehaviour
// which exists only while the player has that screen open. Strategy.Activate()
// calls CanBeActivated itself, so with the screen shut both throw and the console
// could not appoint a leader or accept a program at all.
//
// StrategyRP0.ActivateOverride is gate-plus-procedure and nothing else: its whole
// body is `if (!CanBeActivated(ref reason)) return false; PerformActivate(true);
// return true;`. PerformActivate is PUBLIC, non-virtual, and never asks
// CanBeActivated. So the route is to run the gate ourselves and call the
// procedure directly, and arm 1 is never asked rather than answered.
//
// THE RULE THIS OBEYS, which is the reason it is not a bypass:
//
//   Register() / Unregister() are on the SHARED path. They run on a fresh
//   activation AND on every restore, because Strategy.Load() ends with
//   `isActive = true; Register();`. Accept-side effects therefore belong to the
//   fresh-activation procedure, never inside OnRegister.
//
// A leader OBEYS that rule: its effects live in PerformActivate, outside
// Register(), and StrategyRP0.OnRegister is base-only. A program BREAKS it:
// ProgramStrategy.OnRegister calls ActivateProgram, and RP-1 excludes the restore
// case by testing ProgramHandler.IsInAdmin, a UI flag standing in for "is this a
// fresh activation". So IsInAdmin is not a UI guard, it is a
// fresh-activation-vs-restore discriminator, and hoisting ActivateProgram out to
// the real activation event is the CORRECT placement rather than a workaround.
//
// StrategySystem is a ScenarioModule declared for FLIGHT, TRACKSTATION,
// SPACECENTER and EDITOR, and a ScenarioModule loads on entry to every scene in
// its list, so the restore path runs on every scene transition rather than once
// per load. Without RP-1's guard a program would re-Accept several times a
// session, re-charging Confidence and resetting its deadline each time.
//
// THE TWO FAILURES THIS SHAPE HAS, both of which the callers must handle:
//
//   1. DOUBLE ACCEPT. If the Administration screen happens to be open when the
//      command arrives, PerformActivate's own Register() will call
//      ActivateProgram itself, because IsInAdmin is then true. A caller that also
//      calls it explicitly accepts twice: two Accept()s, two Confidence charges,
//      a duplicate ActivePrograms entry and a restarted funding schedule. The
//      remote console is exactly the case where the screen may be open, so
//      IsInAdmin has to be READ and branched on, never assumed false.
//   2. CALL ORDER. In-screen, ActivateProgram runs INSIDE Register(), which is
//      step 2 of PerformActivate, before its alarm block. PerformActivate's
//      program arm mints a KAC alarm against programStrategy.Program.deadlineUT,
//      and Accept() sets deadlineUT on the NEW instance it returns rather than on
//      the template. So calling PerformActivate first leaves _program as the
//      template, whose deadlineUT was never assigned, and the alarm is created at
//      UT 0 silently. ActivateProgram must run FIRST.
//
// PROVENANCE. Every member here was read out of an ilspycmd disassembly of the
// INSTALLED RP-1 v4.6.0.0 RP0.dll and of the installed Assembly-CSharp, and
// PerformActivate and ActivateOverride were additionally confirmed at IL. The
// disassembly verifies SHAPE and never VALUE: nothing here has been exercised
// against a running game, so every hop is null-safe.
using System;
using System.Reflection;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// Resolution for the members a strategy activation invokes outside the
    /// Administration Building.
    /// </summary>
    public static class Rp1StrategyWrites
    {
        /// <summary>RP-1's strategy base, which carries the procedure we call.</summary>
        public const string StrategyRp0TypeName = "RP0.StrategyRP0";

        /// <summary>The subclass whose activation is split in half; see the header.</summary>
        public const string ProgramStrategyTypeName = "RP0.Programs.ProgramStrategy";

        /// <summary>Owns the program half and the fresh-vs-restore flag.</summary>
        public const string ProgramHandlerTypeName = "RP0.Programs.ProgramHandler";

        /// <summary>
        /// The parameter type that tells the two <c>ActivateProgram</c> overloads
        /// apart; see <see cref="ActivateProgram"/>.
        /// </summary>
        public const string ProgramTypeName = "RP0.Programs.Program";

        /// <summary>
        /// <c>StrategyRP0.PerformActivate(bool useCurrency)</c>.
        ///
        /// <para>The ENTIRE fresh-activation procedure for a leader: it sets
        /// <c>isActive</c>, calls <c>Register()</c>, stamps <c>dateActivated</c>
        /// and <c>ActivatedStrategies</c>, charges <c>SetupCosts</c>, recalculates
        /// build rates, fires <c>OnLeaderChange</c>, writes the career log and
        /// creates the KAC alarms.</para>
        ///
        /// <para>Confirmed at IL as <c>public</c>, arity 1 and NON-VIRTUAL, so no
        /// subclass can substitute a different body for it. It never calls
        /// <c>CanBeActivated</c>, which is the whole reason this route exists.</para>
        /// </summary>
        public static MethodInfo? PerformActivate(object? strategy) =>
            strategy == null ? null : Rp1Types.InstanceMethod(strategy, "PerformActivate", 1);

        /// <summary>
        /// <c>ProgramHandler.ActivateProgram(Program p)</c>, resolved by
        /// first-parameter TYPE because a same-named
        /// <c>ActivateProgram(string, Program.Speed)</c> overload sits beside it
        /// and a lookup by arity alone could pick either.
        ///
        /// <para>The program half that <c>OnRegister</c> skips when the screen is
        /// shut: it calls <c>p.Accept()</c> (where the Confidence charge and the
        /// deadline live), adds to <c>ActivePrograms</c>, disables the programs
        /// the accepted one excludes, resets contract generation failure, hands
        /// the accepted instance to the strategy, and sets
        /// <c>StartedProgram</c>.</para>
        /// </summary>
        public static MethodInfo? ActivateProgram(object? programHandler) =>
            programHandler == null
                ? null
                : Rp1Types.InstanceMethodOn(programHandler, "ActivateProgram", ProgramTypeName, 1);

        /// <summary>
        /// Whether RP-1 currently considers itself to be in the Administration
        /// screen.
        ///
        /// <para>Read, never written, and never assumed. See failure 1 in the
        /// header: with this true, <c>PerformActivate</c>'s own <c>Register()</c>
        /// performs the program half itself, and a caller that also performs it
        /// accepts twice.</para>
        ///
        /// <para>Null when the flag could not be read at all, which callers must
        /// treat as "cannot tell" and refuse on, rather than as false.</para>
        /// </summary>
        public static bool? IsInAdmin(object? programHandler) =>
            programHandler == null ? null : Rp1Types.ReadBool(programHandler, "IsInAdmin");

        /// <summary>
        /// Whether this strategy is the subclass whose activation is split.
        ///
        /// <para>Asserted POSITIVELY by the caller rather than inferred from a
        /// department name: a leader is defined negatively in RP-1 terms (any
        /// strategy whose department is not Programs), and a negative definition
        /// is the wrong thing to bet a currency charge on.</para>
        /// </summary>
        public static bool IsProgramStrategy(object? strategy, Type? programStrategy) =>
            strategy != null && programStrategy != null && programStrategy.IsInstanceOfType(strategy);

        /// <summary>
        /// The <c>Program</c> this strategy carries, which is the TEMPLATE before
        /// acceptance and the accepted copy afterwards.
        ///
        /// <para>The distinction is failure 2 in the header: the template's
        /// <c>deadlineUT</c> is never assigned, so anything reading it before
        /// <c>Accept()</c> has run gets zero.</para>
        /// </summary>
        public static object? Program(object? programStrategy) =>
            Rp1Types.Member(programStrategy, "Program");
    }
}
