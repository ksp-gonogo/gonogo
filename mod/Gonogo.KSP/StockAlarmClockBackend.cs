using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Gonogo.KSP
{
    /// <summary>
    /// The <c>gameAlarmClock</c> capability over KSP's stock Alarm Clock
    /// (<c>AlarmClockScenario</c>). Main thread only, as the interface says.
    ///
    /// <para>The stock scenario runs in flight, the space centre and the
    /// tracking station. An install that hides the stock clock's button still
    /// runs the scenario, so its alarms are read and written here even when the
    /// player cannot see them in the game.</para>
    /// </summary>
    public sealed class StockAlarmClockBackend : IGameAlarmClock
    {
        public string ProviderId => "stock";

        public bool Available => AlarmClockScenario.Instance != null && AlarmClockScenario.Instance.alarms != null;

        public IReadOnlyList<GameAlarmRecord> Alarms()
        {
            var records = new List<GameAlarmRecord>();
            if (!Available)
            {
                return records;
            }
            foreach (var alarm in AlarmClockScenario.Instance.alarms.Values)
            {
                if (alarm == null)
                {
                    continue;
                }
                records.Add(new GameAlarmRecord
                {
                    Id = alarm.Id,
                    Kind = KindOf(alarm),
                    Title = alarm.title ?? "",
                    Ut = alarm.ut,
                    Vessel = VesselGuidOf(alarm.vesselId),
                    Warp = WarpOf(alarm.actions),
                    Triggered = alarm.Triggered,
                });
            }
            return records;
        }

        public long? CreateAtUt(string title, double ut)
        {
            if (!Available || double.IsNaN(ut) || double.IsInfinity(ut))
            {
                return null;
            }
            var alarm = new AlarmTypeRaw
            {
                title = string.IsNullOrEmpty(title) ? "Gonogo alarm" : title,
                description = "",
                ut = ut,
                // Gonogo's own alarm stops the warp with its own lead; the
                // game's copy must not stop it a second time on its own ramp.
                actions = new AlarmActions(
                    AlarmActions.WarpEnum.DoNothing,
                    AlarmActions.MessageEnum.Yes,
                    PlaySound: false,
                    DeleteWhenDone: true),
            };
            return AlarmClockScenario.AddAlarm(alarm) ? alarm.Id : (long?)null;
        }

        public bool Delete(long id)
        {
            if (!Available || id < 0 || id > uint.MaxValue)
            {
                return false;
            }
            return AlarmClockScenario.DeleteAlarm((uint)id);
        }

        private static GameAlarmKind KindOf(AlarmTypeBase alarm)
        {
            switch (alarm)
            {
                case AlarmTypeRaw _: return GameAlarmKind.Time;
                case AlarmTypeTransferWindow _: return GameAlarmKind.TransferWindow;
                case AlarmTypeSOI _: return GameAlarmKind.SoiChange;
                case AlarmTypeApoapsis _: return GameAlarmKind.Apoapsis;
                case AlarmTypePeriapsis _: return GameAlarmKind.Periapsis;
                case AlarmTypeManeuver _: return GameAlarmKind.Maneuver;
                default: return GameAlarmKind.Other;
            }
        }

        private static GameAlarmWarp WarpOf(AlarmActions? actions)
        {
            switch (actions?.warp)
            {
                case AlarmActions.WarpEnum.DoNothing: return GameAlarmWarp.Nothing;
                case AlarmActions.WarpEnum.PauseGame: return GameAlarmWarp.Pause;
                default: return GameAlarmWarp.StopWarp;
            }
        }

        /// <summary>The craft's guid for a stock alarm's persistent id, or null when it names none or the craft is gone.</summary>
        private static string? VesselGuidOf(uint persistentId)
        {
            if (persistentId == 0)
            {
                return null;
            }
            return FlightGlobals.FindVessel(persistentId, out var vessel) && vessel != null
                ? vessel.id.ToString()
                : null;
        }
    }
}
