using System;
using System.Collections.Generic;
using System.Globalization;
using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// ConfigNode round-trip for the armed rows of the SCET alarm roster, one
    /// child node per alarm. Only an armed alarm is written: a fired, cancelled
    /// or deleted one is history the clients that cared have already recorded.
    ///
    /// <para>A row whose fields will not parse is skipped rather than throwing,
    /// since the cost of dropping one alarm is that its client arms it again,
    /// and the cost of throwing is the whole scenario module's OnLoad.</para>
    /// </summary>
    public static class ScetRosterPersistence
    {
        private const string RootNodeName = "SCET_ALARMS";
        private const string AlarmNodeName = "ALARM";
        private const string ConditionNodeName = "CONDITION";
        private const string ActionNodeName = "ACTION";

        public static void Save(IEnumerable<ScetAlarm> roster, ConfigNode node)
        {
            if (roster == null || node == null)
            {
                return;
            }

            var root = node.AddNode(RootNodeName);
            foreach (var alarm in roster)
            {
                if (alarm == null || alarm.State != ScetAlarmState.Armed || alarm.Condition == null || string.IsNullOrEmpty(alarm.Id))
                {
                    continue;
                }

                var row = root.AddNode(AlarmNodeName);
                row.AddValue("id", alarm.Id);
                row.AddValue("name", alarm.Name ?? "");
                row.AddValue("armedBy", alarm.ArmedBy ?? "");
                row.AddValue("vantage", alarm.Vantage ?? "");
                row.AddValue("subject", alarm.Subject ?? "");
                row.AddValue("actsOn", alarm.ActsOn ?? "");
                row.AddValue("gameEdits", alarm.GameEdits.ToString(CultureInfo.InvariantCulture));
                if (alarm.GameAlarmId.HasValue)
                {
                    row.AddValue("gameAlarmId", alarm.GameAlarmId.Value.ToString(CultureInfo.InvariantCulture));
                }

                var c = alarm.Condition;
                var condition = row.AddNode(ConditionNodeName);
                condition.AddValue("kind", ((int)c.Kind).ToString(CultureInfo.InvariantCulture));
                condition.AddValue("ut", Number(c.Ut));
                condition.AddValue("leadSeconds", Number(c.LeadSeconds));
                condition.AddValue("topic", c.Topic ?? "");
                condition.AddValue("fieldPath", c.FieldPath ?? "");
                condition.AddValue("op", ((int)c.Op).ToString(CultureInfo.InvariantCulture));
                condition.AddValue("threshold", Number(c.Threshold));
                condition.AddValue("sustainSeconds", Number(c.SustainSeconds));
                condition.AddValue("contractId", c.ContractId ?? "");
                condition.AddValue("parameterTitle", c.ParameterTitle ?? "");
                condition.AddValue("targetState", ((int)c.TargetState).ToString(CultureInfo.InvariantCulture));

                foreach (var action in alarm.OnFire ?? new List<ScetAlarmAction>())
                {
                    var actionNode = row.AddNode(ActionNodeName);
                    actionNode.AddValue("kind", ((int)action.Kind).ToString(CultureInfo.InvariantCulture));
                    actionNode.AddValue("group", action.Group.ToString(CultureInfo.InvariantCulture));
                }
            }
        }

        /// <summary>The alarms the node holds, empty for a save from before this existed.</summary>
        public static List<ScetAlarm> Load(ConfigNode node)
        {
            var alarms = new List<ScetAlarm>();
            var root = node?.GetNode(RootNodeName);
            if (root == null)
            {
                return alarms;
            }

            foreach (var row in root.GetNodes(AlarmNodeName))
            {
                var alarm = Read(row);
                if (alarm != null)
                {
                    alarms.Add(alarm);
                }
            }
            return alarms;
        }

        private static ScetAlarm? Read(ConfigNode row)
        {
            var id = row.GetValue("id");
            var conditionNode = row.GetNode(ConditionNodeName);
            if (string.IsNullOrEmpty(id) || conditionNode == null)
            {
                return null;
            }

            if (!TryInt(conditionNode, "kind", out var kind)
                || !TryDouble(conditionNode, "ut", out var ut)
                || !TryDouble(conditionNode, "leadSeconds", out var lead)
                || !TryInt(conditionNode, "op", out var op)
                || !TryDouble(conditionNode, "threshold", out var threshold)
                || !TryDouble(conditionNode, "sustainSeconds", out var sustain)
                || !TryInt(conditionNode, "targetState", out var target))
            {
                return null;
            }

            var alarm = new ScetAlarm
            {
                Id = id,
                Name = row.GetValue("name") ?? "",
                ArmedBy = row.GetValue("armedBy") ?? "",
                Vantage = row.GetValue("vantage") ?? "",
                Subject = row.GetValue("subject") ?? "game",
                ActsOn = row.GetValue("actsOn") ?? "",
                State = ScetAlarmState.Armed,
                Condition = new ScetAlarmCondition
                {
                    Kind = (ScetAlarmConditionKind)kind,
                    Ut = ut,
                    LeadSeconds = lead,
                    Topic = conditionNode.GetValue("topic") ?? "",
                    FieldPath = conditionNode.GetValue("fieldPath") ?? "",
                    Op = (ScetAlarmThresholdOp)op,
                    Threshold = threshold,
                    SustainSeconds = sustain,
                    ContractId = conditionNode.GetValue("contractId") ?? "",
                    ParameterTitle = conditionNode.GetValue("parameterTitle") ?? "",
                    TargetState = (KspParameterState)target,
                },
            };

            if (TryInt(row, "gameEdits", out var edits))
            {
                alarm.GameEdits = edits;
            }
            if (long.TryParse(row.GetValue("gameAlarmId"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var gameId))
            {
                alarm.GameAlarmId = gameId;
            }

            foreach (var actionNode in row.GetNodes(ActionNodeName))
            {
                if (TryInt(actionNode, "kind", out var actionKind) && TryInt(actionNode, "group", out var group))
                {
                    alarm.OnFire.Add(new ScetAlarmAction { Kind = (ScetAlarmActionKind)actionKind, Group = group });
                }
            }
            return alarm;
        }

        private static string Number(double value) => value.ToString("R", CultureInfo.InvariantCulture);

        private static bool TryInt(ConfigNode node, string key, out int value) =>
            int.TryParse(node.GetValue(key), NumberStyles.Integer, CultureInfo.InvariantCulture, out value);

        private static bool TryDouble(ConfigNode node, string key, out double value) =>
            double.TryParse(node.GetValue(key), NumberStyles.Float, CultureInfo.InvariantCulture, out value);
    }
}
