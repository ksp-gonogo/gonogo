using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Alarms
{
    /// <summary>
    /// The text shown on the game screen when a Gonogo alarm fires, so a player
    /// at the game learns of it without a popup that needs closing.
    /// </summary>
    public static class GameAlarmNotice
    {
        /// <summary>The alarm's own name for each fired notice, in firing order. A notice naming no alarm on the roster is skipped.</summary>
        public static List<string> Texts(IReadOnlyList<ScetAlarm> roster, IEnumerable<ScetAlarmFired> fired)
        {
            var texts = new List<string>();
            foreach (var notice in fired)
            {
                foreach (var alarm in roster)
                {
                    if (alarm != null && alarm.Id == notice.Id)
                    {
                        texts.Add(GameAlarmMirror.TitleOf(alarm));
                        break;
                    }
                }
            }
            return texts;
        }
    }
}
