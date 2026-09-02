// The two stock career purchases RP-1 turns into queued projects, refused with
// their reason. No compile-time reference to RP0.dll, the same arm's-length
// reflection pattern as Rp1ScReflection, whose header carries the provenance
// rules this file follows.
//
// WHAT WAS WRONG. `career.facility.upgrade` calls UpgradeableFacility.SetLevel
// and `career.tech.unlock` buys the node outright, and core gates both on career
// mode plus the STOCK facility caps. Under RP-1 neither act exists in that shape:
// a facility upgrade is a FacilityUpgradeProject a construction queue works
// through at a rate, and a tech node is a ResearchProject researchers work
// through at a rate, both with a cost RP-1 prices and a duration it decides.
//
// RP-1 blocks its own equivalents at the UI layer only. Its Harmony patch on
// KSCFacilityContextMenu is what stops the stock upgrade button, and nothing at
// all patches UpgradeableFacility.SetLevel. So a command dispatched from outside
// that menu walks straight past it: the facility jumps a tier instantly, at the
// stock price, next to a construction queue that never heard of it, into a state
// RP-1's own model has no way to produce. The research side is the same shape
// against RP-1's research queue.
//
// WHY THIS REFUSES RATHER THAN ENQUEUING. The operator's goal is a tier-2 pad,
// and under RP-1 the only thing that reaches it is a construction project with a
// duration. Answering the press by enqueuing one would be a different act from
// the one the control offers: a different price, a completion weeks away, and a
// queue position that depends on how many engineers are assigned. That belongs
// to a command of its own in this Uplink's own namespace, the way rp1.build.repeat
// is a command of its own rather than a redefinition of ksp.launch. The refusal
// is what has to exist either way, because it is the only thing that stops the
// stock write, and the queue it names is already on the board: rp1.constructions
// and rp1.research publish both.
//
// BOTH HALVES NOW HAVE THEIR COMMAND. rp1.tech.research (Rp1ResearchCommands)
// and rp1.facility.upgrade (Rp1FacilityUpgradeCommands) are the RP-1-native acts
// these refusals describe, so both sentences name one. Until the facility command
// existed its sentence named a PLACE, and sending an operator into the game for
// something now on their own board is exactly the drift this refusal is for.
//
// WHAT IS READ, and why each is safe:
//
//   SpaceCenterManagement.Instance / .enabledForSave
//                                    the same two reads Rp1ScReflection opens
//                                    with, vouched for there
//
// Nothing is invoked and nothing is written. Every arm that cannot read its
// answer returns Unknown, which the engine treats as a refusal, so an
// unanswerable question leaves the stock write blocked rather than open.
//
// PROVENANCE. Both members were read out of an ilspycmd disassembly of the
// INSTALLED RP-1 v4.6.0.0 RP0.dll. The disassembly verifies SHAPE and never
// VALUE: nothing here has been exercised against a running game, so every hop is
// null-safe.
using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace GonogoRp1Uplink
{
    /// <summary>
    /// Whether a stock career purchase is still a purchase, for the two that RP-1
    /// re-models as queued projects.
    ///
    /// <para>One kind answering two quantities rather than two evaluators,
    /// because both turn on the same single read: a facility upgrade and a tech
    /// unlock are the same fact about the save asked from two commands, and the
    /// only thing that differs between them is the sentence an operator reads.
    /// Same shape as <see cref="Rp1LaunchGate"/>, which answers three.</para>
    ///
    /// <para>Nothing here touches KSP or Unity, so it compiles and runs headless
    /// against a stand-in object graph.</para>
    /// </summary>
    public sealed class Rp1CareerProjectGate : ICommandGateEvaluator
    {
        /// <summary>
        /// The requirement kind this answers. Namespaced to this Uplink because a
        /// kind may only be claimed once across the whole engine.
        /// </summary>
        public const string GateKind = "rp1.careerProject";

        /// <summary>Raising a facility a tier is still an outright purchase.</summary>
        public const string FacilityUpgrade = "facilityUpgrade";

        /// <summary>Unlocking a tech node is still an outright purchase.</summary>
        public const string TechUnlock = "techUnlock";

        private const string ScmTypeName = "RP0.SpaceCenterManagement";

        /// <summary>
        /// What an operator reads under a managed career, as the clause after
        /// "Upgrade Launch Pad unavailable:". Names the shape of RP-1's model
        /// first, because that is what makes the refusal make sense, and then the
        /// command that actually starts the job.
        /// </summary>
        private const string FacilityDetail =
            "RP-1 builds a facility upgrade as a construction project with its own cost and duration, "
            + "so it has to be queued rather than bought outright. Use rp1.facility.upgrade";

        /// <summary>
        /// The research half of <see cref="FacilityDetail"/>. Both halves now name
        /// the command they defer to: this file's header said each belonged in
        /// this Uplink's own namespace and both have since been written, so a
        /// refusal pointing only at a building would send an operator into the
        /// game for something on their own board.
        /// </summary>
        private const string TechDetail =
            "RP-1 researches a tech node as a queued project with its own duration, "
            + "so it has to be queued rather than bought outright. Use rp1.tech.research";

        private readonly Type? _scm;

        public Rp1CareerProjectGate()
        {
            _scm = Rp1Types.Find(ScmTypeName);
        }

        /// <summary>
        /// RP-1 is installed, decided on the TYPE resolving for the reason
        /// <see cref="Rp1ScReflection"/>'s own probe gives. False means neither
        /// requirement is contributed at all, so both commands keep exactly the
        /// requirements core declares and the stock path is byte-for-byte what it
        /// was.
        /// </summary>
        public bool IsAvailable => _scm != null;

        /// <summary>
        /// The requirement to contribute to <c>career.facility.upgrade</c>.
        /// </summary>
        /// <remarks>
        /// No <see cref="CommandRequirement.Needs"/>, which is what makes it worth
        /// declaring: the engine can evaluate it with an empty argument bag, so
        /// the control is drawn dark with its reason before anyone presses it
        /// rather than only answering the press.
        /// </remarks>
        public static CommandRequirement FacilityRequirement() =>
            new CommandRequirement { Kind = GateKind, Quantity = FacilityUpgrade };

        /// <summary>The same, for <c>career.tech.unlock</c>.</summary>
        public static CommandRequirement TechRequirement() =>
            new CommandRequirement { Kind = GateKind, Quantity = TechUnlock };

        /// <summary>Both, for a caller that wants to walk them.</summary>
        public static IEnumerable<CommandRequirement> Requirements()
        {
            yield return FacilityRequirement();
            yield return TechRequirement();
        }

        public string Kind => GateKind;

        public GateVerdict Evaluate(CommandRequirement requirement, IGateArguments arguments)
        {
            var quantity = requirement?.Quantity ?? "";
            if (quantity != FacilityUpgrade && quantity != TechUnlock)
            {
                return GateVerdict.Unknown($"RP-1 imposes no career condition called \"{quantity}\"");
            }

            var scm = ScmInstance();
            if (scm == null)
            {
                // RP-1 is installed and its scenario module is not there, so
                // whether this save is one it manages cannot be read. Unknown
                // refuses, which is the direction that matters here: the write
                // this guards is the one that cannot be taken back.
                return GateVerdict.Unknown("RP-1's space centre is not loaded");
            }

            var enabled = Rp1Types.ReadBool(scm, "enabledForSave");
            if (enabled == null)
            {
                return GateVerdict.Unknown("could not read whether RP-1 manages this save");
            }
            if (enabled == false)
            {
                // A save RP-1 declines to run in has no construction queue and no
                // research queue, so the stock purchase is the whole of what
                // happens and there is nothing outstanding. A real reading rather
                // than a shrug: RP-1 says so in its own field.
                return GateVerdict.Pass();
            }

            return GateVerdict.Fail(
                CommandErrorCode.ModeUnavailable,
                quantity == FacilityUpgrade ? FacilityDetail : TechDetail);
        }

        private object? ScmInstance() => _scm == null ? null : Rp1Types.StaticValue(_scm, "Instance");
    }
}
