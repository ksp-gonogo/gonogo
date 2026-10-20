using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>What a switch request on a converter comes to.</summary>
    internal enum ConverterMove
    {
        /// <summary>The converter is already in the requested state, so nothing is touched.</summary>
        AlreadyThere,

        /// <summary>The converter is switched.</summary>
        Switch,

        /// <summary>The game would not do it; the plan carries the refusal.</summary>
        Refuse,
    }

    /// <summary>A switch request decided, with the refusal when there is one.</summary>
    internal readonly struct ConverterPlan
    {
        public ConverterPlan(ConverterMove move, Refusal? refusal = null)
        {
            Move = move;
            Refusal = refusal;
        }

        public ConverterMove Move { get; }

        public Refusal? Refusal { get; }
    }

    /// <summary>
    /// Decides a switch request on a <c>BaseConverter</c>, including the one
    /// refusal <c>StartResourceConverter()</c> makes: a converter whose part has
    /// an animation group (a lab that unfolds, a drill that extends) will not
    /// switch on until the group is deployed.
    ///
    /// <para>The game returns <c>void</c> and posts a screen message, leaving
    /// <c>IsActivated</c> false, so calling it and answering success reports a
    /// start that never happened. The fact is askable first
    /// (<c>hasAnimationGroup</c> and the private
    /// <c>IsAnimationGroupDeployed()</c>), and is carved out here so the order
    /// and the codes can be entered by a test; the converter actuator reads the
    /// facts off the live module.</para>
    /// </summary>
    internal static class ConverterRunRule
    {
        /// <summary>
        /// The move for a request to switch a converter on or off. A converter
        /// already in the requested state is left alone, which is what makes a
        /// resent command harmless.
        /// </summary>
        /// <param name="activated">Whether the converter is switched on now.</param>
        /// <param name="wantOn">The requested state.</param>
        /// <param name="hasAnimationGroup">Whether the part carries an animation group the converter waits on.</param>
        /// <param name="animationDeployed">Whether that group is deployed. Ignored without a group.</param>
        /// <param name="needsDeployMessage">The sentence naming what to do first, already resolved.</param>
        public static ConverterPlan Plan(
            bool activated,
            bool wantOn,
            bool hasAnimationGroup,
            bool animationDeployed,
            string needsDeployMessage)
        {
            if (activated == wantOn)
            {
                return new ConverterPlan(ConverterMove.AlreadyThere);
            }

            if (wantOn && hasAnimationGroup && !animationDeployed)
            {
                // Deploying the part changes this, which is what makes it a
                // state to fix rather than a capability the craft lacks.
                return new ConverterPlan(
                    ConverterMove.Refuse,
                    new Refusal(CommandErrorCode.WrongState, needsDeployMessage));
            }

            return new ConverterPlan(ConverterMove.Switch);
        }
    }
}
