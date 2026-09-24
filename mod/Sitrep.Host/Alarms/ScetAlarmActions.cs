using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Alarms
{
    /// <summary>
    /// A SCET alarm's onboard actions: which arms may carry them, and running
    /// them in the frame the alarm fires. KSP-free, so both halves are exercised
    /// headlessly; the caller supplies the craft being flown and each group's
    /// current state.
    ///
    /// <para>Every action goes through the same <see cref="VesselCommandProvider"/>
    /// handler its own command uses, so an alarm and a button cannot drift into
    /// firing a group two different ways.</para>
    /// </summary>
    public static class ScetAlarmActions
    {
        /// <summary>
        /// The craft an arm's actions act on: <see cref="ScetAlarmArmArgs.ActsOn"/>
        /// when it names one, else the subject of a threshold on a craft, else
        /// empty.
        /// </summary>
        public static string ActsOnOf(ScetAlarmArmArgs args)
        {
            if (!string.IsNullOrEmpty(args.ActsOn))
            {
                return args.ActsOn;
            }
            var subject = ScetAlarmVantage.SubjectOf(args);
            return IsCraft(subject) ? subject : "";
        }

        /// <summary>
        /// Why this arm may not carry the actions it names, or null when it may
        /// (including when it names none).
        ///
        /// <para>An action runs aboard the craft in the frame the alarm fires, so
        /// the condition must be one the craft itself could have judged in that
        /// frame. A reading of the craft at its own vantage is; so is a time,
        /// which is the game's clock and a sequencer aboard keeps it. What a
        /// command centre has been told is not, and neither is the game's own
        /// state (a career's funds): acting on either would carry information to
        /// the craft faster than light.</para>
        /// </summary>
        public static string? RefusalFor(ScetAlarmArmArgs args)
        {
            if (args.OnFire == null || args.OnFire.Count == 0)
            {
                return null;
            }
            var subject = ScetAlarmVantage.SubjectOf(args);
            if (!string.Equals(ScetAlarmVantage.Of(args), subject, StringComparison.Ordinal))
            {
                return "an onboard action needs the alarm read aboard the craft, not at '"
                    + ScetAlarmVantage.Of(args) + "'";
            }
            var condition = args.Condition ?? new ScetAlarmCondition();
            if (!IsCraft(subject) && condition.Kind != ScetAlarmConditionKind.Time)
            {
                return "'" + subject + "' is not aboard any craft, so no onboard action can follow it";
            }
            var actsOn = ActsOnOf(args);
            if (!IsCraft(actsOn))
            {
                return "an onboard action needs the craft it acts on";
            }
            if (IsCraft(subject) && !string.Equals(actsOn, subject, StringComparison.Ordinal))
            {
                return "an onboard action acts on the craft its alarm reads, '" + subject + "'";
            }
            foreach (var action in args.OnFire)
            {
                if (action == null || !Enum.IsDefined(typeof(ScetAlarmActionKind), action.Kind))
                {
                    return "an onboard action names no known kind";
                }
                if (action.Kind == ScetAlarmActionKind.ActionGroup && action.Group < 1)
                {
                    return "an action group is numbered from 1";
                }
            }
            return null;
        }

        /// <summary>
        /// Run one fire's actions if the craft they act on is the one being
        /// flown, and otherwise withhold every one of them and say so on the
        /// notice. Returns the result of each action that ran, in order.
        /// </summary>
        /// <param name="flying">The craft being flown, as <c>"vessel:&lt;guid&gt;"</c>, or null for none.</param>
        /// <param name="engaged">A toggle's current state, or null where the craft does not report it.</param>
        public static List<CommandResult> Run(
            ScetAlarmActionsDue due,
            string? flying,
            IVesselActuator actuator,
            Func<ScetAlarmAction, bool?> engaged)
        {
            var results = new List<CommandResult>(due.Actions.Count);
            if (!string.Equals(due.ActsOn, flying, StringComparison.Ordinal))
            {
                due.Notice.ActionsWithheld = true;
                return results;
            }
            foreach (var action in due.Actions)
            {
                results.Add(RunOne(action, actuator, engaged));
            }
            return results;
        }

        /// <summary>
        /// One action, through its own command's handler. A toggle whose current
        /// state is unknown is refused rather than guessed: setting a group the
        /// wrong way is worse than leaving it.
        /// </summary>
        public static CommandResult RunOne(
            ScetAlarmAction action, IVesselActuator actuator, Func<ScetAlarmAction, bool?> engaged)
        {
            if (action.Kind == ScetAlarmActionKind.Stage)
            {
                return VesselCommandProvider.HandleStage(actuator, null);
            }
            var now = engaged(action);
            if (now == null)
            {
                return CommandResult.Fail(
                    CommandErrorCode.NotClearToProceed, "the craft does not report this group's state");
            }
            var flip = new SetEnabledArgs { Enabled = !now.Value };
            switch (action.Kind)
            {
                case ScetAlarmActionKind.ActionGroup:
                    return VesselCommandProvider.HandleSetActionGroup(
                        actuator, new SetActionGroupArgs { Group = action.Group, State = !now.Value });
                case ScetAlarmActionKind.Sas:
                    return VesselCommandProvider.HandleSetSas(actuator, flip);
                case ScetAlarmActionKind.Rcs:
                    return VesselCommandProvider.HandleSetRcs(actuator, flip);
                case ScetAlarmActionKind.Lights:
                    return VesselCommandProvider.HandleSetLights(actuator, flip);
                case ScetAlarmActionKind.Gear:
                    return VesselCommandProvider.HandleSetGear(actuator, flip);
                case ScetAlarmActionKind.Brakes:
                    return VesselCommandProvider.HandleSetBrakes(actuator, flip);
                case ScetAlarmActionKind.Abort:
                    return VesselCommandProvider.HandleSetAbort(actuator, flip);
                default:
                    return CommandResult.Fail(CommandErrorCode.Range);
            }
        }

        private static bool IsCraft(string? id) =>
            id != null && id.StartsWith("vessel:", StringComparison.Ordinal) && id.Length > "vessel:".Length;
    }
}
