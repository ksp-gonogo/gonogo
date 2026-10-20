using System;
using System.Reflection;
using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// Switches a <c>BaseConverter</c> on and off, and says whether that changed
    /// anything. The one actuator behind every converter a command can reach:
    /// the Mobile Processing Lab's Start and Stop Research today, and any other
    /// converter (a drill, an ISRU unit, a fuel cell) the same way.
    ///
    /// <para>Idempotent: a converter already in the requested state answers
    /// success with <see cref="RunStateChange.Changed"/> false and is not
    /// touched. A start the game would refuse is refused here with a typed code
    /// instead, because <c>StartResourceConverter</c> returns <c>void</c> and
    /// leaves only a screen message, so a bare call reports a start that did not
    /// happen. The animation check is asked first through
    /// <see cref="ConverterRunRule"/>, and the state is read back after the call
    /// as the check on anything else the game declines.</para>
    /// </summary>
    internal static class KspConverterActuator
    {
        private const BindingFlags Instance = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;

        private static readonly FieldInfo? HasAnimationGroup = typeof(BaseConverter).GetField("hasAnimationGroup", Instance);

        private static readonly MethodInfo? IsAnimationGroupDeployed = typeof(BaseConverter).GetMethod("IsAnimationGroupDeployed", Instance);

        public static CommandResult Set(BaseConverter converter, bool on)
        {
            var plan = Plan(converter, on);
            switch (plan.Move)
            {
                case ConverterMove.AlreadyThere:
                    return Result(changed: false, running: on);
                case ConverterMove.Refuse:
                    return CommandResult<RunStateChange>.Fail(plan.Refusal!.Value.Code, plan.Refusal.Value.Detail);
            }

            if (!on)
            {
                converter.StopResourceConverter();
                return Result(changed: true, running: converter.IsActivated);
            }

            converter.StartResourceConverter();
            if (!converter.IsActivated)
            {
                // The game declined for a reason this actuator does not know.
                return CommandResult<RunStateChange>.Fail(
                    CommandErrorCode.WrongState, "the game would not start it");
            }

            return Result(changed: true, running: true);
        }

        private static CommandResult Result(bool changed, bool running) =>
            CommandResult<RunStateChange>.Ok(new RunStateChange { Changed = changed, Running = running });

        private static ConverterPlan Plan(BaseConverter converter, bool on)
        {
            var hasGroup = false;
            var deployed = true;
            try
            {
                hasGroup = HasAnimationGroup?.GetValue(converter) is true;
                deployed = !hasGroup || IsAnimationGroupDeployed?.Invoke(converter, null) is true;
            }
            catch (Exception)
            {
                // A precheck that cannot be read must not refuse a start the
                // game would allow: the read-back after the call still catches
                // a start that did not take.
                hasGroup = false;
            }

            return ConverterRunRule.Plan(
                converter.IsActivated,
                on,
                hasGroup,
                deployed,
                "the part must be deployed before it can start");
        }
    }
}
