using Sitrep.Contract;

namespace Sitrep.Host
{
    /// <summary>
    /// What a lamp command answers for a kerbal, from the facts about that kerbal alone so
    /// a headless test can enter it: the live read is the actuator's, the decision is here.
    /// </summary>
    public static class EvaLampRule
    {
        public const string NotOutside = "no kerbal outside has that id";

        public const string OutOfRange = "the kerbal is out of physics range, so its lamp is not there to switch";

        /// <summary>KSP's own rule: the lamp key acts only on the kerbal being flown.</summary>
        public const string NotFocused = "KSP switches a lamp only for the kerbal it is flying";

        /// <summary>What to do for the kerbal.</summary>
        public enum Outcome
        {
            Switch,
            AlreadyThere,
            Refused,
        }

        /// <param name="found">Whether the id names a kerbal outside.</param>
        /// <param name="loaded">Whether that kerbal is loaded, which is physics range.</param>
        /// <param name="focused">Whether KSP is flying that kerbal.</param>
        /// <param name="lampOn">The lamp as it stands, or null when it could not be read.</param>
        /// <param name="enabled">The state asked for.</param>
        public static Outcome Decide(bool found, bool loaded, bool focused, bool? lampOn, bool enabled, out RefusalCode? code, out string detail)
        {
            code = null;
            detail = "";
            if (!found)
            {
                code = CommandErrorCode.NotFound;
                detail = NotOutside;
                return Outcome.Refused;
            }

            if (!loaded)
            {
                code = CommandErrorCode.WrongState;
                detail = OutOfRange;
                return Outcome.Refused;
            }

            if (!focused)
            {
                code = CommandErrorCode.WrongState;
                detail = NotFocused;
                return Outcome.Refused;
            }

            return lampOn == enabled ? Outcome.AlreadyThere : Outcome.Switch;
        }
    }
}
