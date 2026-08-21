using Sitrep.Contract;

namespace Gonogo.KSP.Gates
{
    /// <summary>
    /// The requirements the built-in Uplinks declare, written once so a command
    /// declaration reads as what it needs rather than as a bag of strings.
    ///
    /// <para>Every one is STATIC: <see cref="CommandRequirement.Needs"/> is empty,
    /// so the engine can decide it with no arguments at all. That is what makes
    /// the answer askable in advance, which is the whole point of a declared gate
    /// over a check inside the handler. An argument-dependent requirement is
    /// perfectly legal and abstains until the arguments arrive; none of these
    /// need to.</para>
    /// </summary>
    internal static class CareerGates
    {
        /// <summary>The save is a career game (<c>HighLogic.CurrentGame.Mode</c>).</summary>
        public static CommandRequirement CareerMode => new CommandRequirement
        {
            Kind = KspGateEvaluators.Kinds.GameMode,
            Quantity = Game.Modes.CAREER.ToString(),
        };

        /// <summary>A <c>GameVariables</c> limit at one facility's current tier.</summary>
        public static CommandRequirement FacilityLimit(SpaceCenterFacility facility, string quantity) =>
            new CommandRequirement
            {
                Kind = KspGateEvaluators.Kinds.FacilityLimit,
                Facility = facility.ToString(),
                Quantity = quantity,
            };

        /// <summary>A <c>GameVariables.Unlocked*</c> switch at one facility's current tier.</summary>
        public static CommandRequirement FacilityUnlocked(SpaceCenterFacility facility, string quantity) =>
            new CommandRequirement
            {
                Kind = KspGateEvaluators.Kinds.FacilityUnlocked,
                Facility = facility.ToString(),
                Quantity = quantity,
            };

        /// <summary>The game is in one of these scenes (<c>HighLogic.LoadedScene</c>).</summary>
        public static CommandRequirement Scene(params GameScenes[] scenes)
        {
            var names = new string[scenes.Length];
            for (var i = 0; i < scenes.Length; i++) names[i] = scenes[i].ToString();
            return new CommandRequirement
            {
                Kind = KspGateEvaluators.Kinds.Scene,
                Quantity = string.Join("|", names),
            };
        }

        /// <summary>The flight is in a state KSP would let you leave (<c>FlightGlobals.ClearToSave()</c>).</summary>
        public static CommandRequirement ClearToSave => new CommandRequirement
        {
            Kind = KspGateEvaluators.Kinds.ClearToSave,
        };

        /// <summary>
        /// One of the <c>PreFlightTests</c> that needs no built ship, against a
        /// launch site. The site is the DEFAULT: a call that names its own site
        /// is judged on that one instead (see <see cref="PreFlightGate"/>).
        /// </summary>
        public static CommandRequirement PreFlight(string site, string quantity) =>
            new CommandRequirement
            {
                Kind = KspGateEvaluators.Kinds.PreFlight,
                Facility = site,
                Quantity = quantity,
            };
    }
}
