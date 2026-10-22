using System;
using System.Collections.Generic;
using Sitrep.Contract;

namespace Sitrep.Host.Alarms
{
    /// <summary>
    /// The game's alarm clock, split by where each alarm's time comes from and
    /// laid out as the two Topics publish it.
    ///
    /// <para>A time the clock works out from a craft's live state is a reading
    /// of that craft, and goes on the craft's own delayed Topic. A time a player
    /// typed, or one worked out from bodies on rails, is known everywhere at
    /// once and goes on the shared list. Naming a craft does not by itself make
    /// an alarm a reading of it: a player's own time labelled with a craft is
    /// still the player's own time.</para>
    /// </summary>
    public static class GameAlarmBoard
    {
        /// <summary>The Topic every command centre reads at once.</summary>
        public const string ListTopic = "alarm.game.list";

        /// <summary>The per-craft namespace: <c>alarm.game.craft.&lt;guid&gt;.list</c>.</summary>
        public const string CraftPrefix = "alarm.game.craft.";

        /// <summary>The field under a craft's key in <see cref="CraftPrefix"/>.</summary>
        public const string CraftSuffix = ".list";

        public const string DeleteCommand = "alarm.game.delete";

        /// <summary>The Topic of one craft's alarms.</summary>
        public static string CraftTopic(string vesselGuid) => CraftPrefix + vesselGuid + CraftSuffix;

        /// <summary>
        /// The declaration <see cref="CraftPrefix"/> registers under: each
        /// craft's alarms record on that craft's own node, so they are revealed
        /// at each command centre one signal delay later and held at their last
        /// known state while the craft is out of contact.
        /// </summary>
        public static ChannelDeclaration CraftNamespace() => new ChannelDeclaration
        {
            Kind = SampleKind.Discrete,
            Requires = Requirement.None,
            Delivery = Delivery.ReliableOrdered,
            Delay = DelayRole.Delayed,
            Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
            PerVesselNode = true,
        };

        /// <summary>
        /// The declaration of <see cref="ListTopic"/>: the player's own plan,
        /// which no distance applies to.
        /// </summary>
        public static ChannelDeclaration ListChannel() => new ChannelDeclaration
        {
            Kind = SampleKind.Discrete,
            Requires = Requirement.None,
            Topic = ListTopic,
            Delivery = Delivery.ReliableOrdered,
            Delay = DelayRole.TrueNow,
            Emission = new EmissionPolicy(keyframeIntervalUt: 3600, quantum: EmissionQuantum.Absolute(0)),
        };

        /// <summary>
        /// Whether the clock works this kind's time out from a craft's live
        /// state. An unknown kind is treated as one when it names a craft, since
        /// nothing says its time is not a reading of that craft.
        /// </summary>
        public static bool IsCraftDerived(GameAlarmRecord record)
        {
            switch (record.Kind)
            {
                case GameAlarmKind.Time:
                case GameAlarmKind.TransferWindow:
                    return false;
                case GameAlarmKind.SoiChange:
                case GameAlarmKind.Apoapsis:
                case GameAlarmKind.Periapsis:
                case GameAlarmKind.Maneuver:
                    return true;
                default:
                    return !string.IsNullOrEmpty(record.Vessel);
            }
        }

        /// <summary>
        /// Lay the clock out as the two Topics carry it.
        /// <paramref name="mirrorOf"/> names the Gonogo alarm each copy was made
        /// for, by game alarm id.
        /// </summary>
        public static GameAlarmBoardView Build(
            bool available,
            IReadOnlyList<GameAlarmRecord>? records,
            IReadOnlyDictionary<long, string>? mirrorOf)
        {
            var view = new GameAlarmBoardView { Available = available };
            if (!available || records == null)
            {
                return view;
            }
            foreach (var record in records)
            {
                if (record == null)
                {
                    continue;
                }
                string? gonogoId = null;
                mirrorOf?.TryGetValue(record.Id, out gonogoId);
                var alarm = new GameAlarm
                {
                    Id = record.Id,
                    Kind = record.Kind,
                    Title = record.Title ?? "",
                    Ut = record.Ut,
                    Vessel = string.IsNullOrEmpty(record.Vessel) ? null : "vessel:" + record.Vessel,
                    Warp = record.Warp,
                    Triggered = record.Triggered,
                    GonogoId = gonogoId,
                };
                if (!IsCraftDerived(record))
                {
                    view.Plan.Add(alarm);
                    continue;
                }
                // A reading of a craft that no longer exists has no node to be
                // revealed from, so it is shown nowhere.
                if (string.IsNullOrEmpty(record.Vessel))
                {
                    continue;
                }
                if (!view.ByCraft.TryGetValue(record.Vessel!, out var list))
                {
                    list = new List<GameAlarm>();
                    view.ByCraft[record.Vessel!] = list;
                }
                list.Add(alarm);
            }
            view.Plan.Sort(ByUt);
            foreach (var list in view.ByCraft.Values)
            {
                list.Sort(ByUt);
            }
            return view;
        }

        private static int ByUt(GameAlarm a, GameAlarm b)
        {
            var byUt = a.Ut.CompareTo(b.Ut);
            return byUt != 0 ? byUt : a.Id.CompareTo(b.Id);
        }

        /// <summary>The <see cref="ListTopic"/> payload as the wire carries it.</summary>
        public static Dictionary<string, object?> ToWire(GameAlarmList list)
        {
            var alarms = new List<object?>(list.Alarms.Count);
            foreach (var alarm in list.Alarms)
            {
                alarms.Add(ToWire(alarm));
            }
            return new Dictionary<string, object?>
            {
                ["available"] = list.Available,
                ["alarms"] = alarms,
            };
        }

        /// <summary>One craft's alarms as its Topic carries them.</summary>
        public static List<object?> ToWire(IReadOnlyList<GameAlarm> alarms)
        {
            var rows = new List<object?>(alarms.Count);
            foreach (var alarm in alarms)
            {
                rows.Add(ToWire(alarm));
            }
            return rows;
        }

        /// <summary>One <see cref="GameAlarm"/> as the wire carries it.</summary>
        public static Dictionary<string, object?> ToWire(GameAlarm alarm) =>
            new Dictionary<string, object?>
            {
                ["id"] = alarm.Id,
                ["kind"] = (int)alarm.Kind,
                ["title"] = alarm.Title,
                ["ut"] = alarm.Ut,
                ["vessel"] = alarm.Vessel,
                ["warp"] = (int)alarm.Warp,
                ["triggered"] = alarm.Triggered,
                ["gonogoId"] = alarm.GonogoId,
            };

        /// <summary>
        /// A stable text of a payload, to publish only when it moved. Covers
        /// every field the wire carries.
        /// </summary>
        public static string KeyOf(IReadOnlyList<GameAlarm> alarms)
        {
            var parts = new List<string>(alarms.Count);
            foreach (var a in alarms)
            {
                parts.Add(string.Join("\u001f",
                    a.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    ((int)a.Kind).ToString(System.Globalization.CultureInfo.InvariantCulture),
                    a.Title,
                    a.Ut.ToString("R", System.Globalization.CultureInfo.InvariantCulture),
                    a.Vessel ?? "",
                    ((int)a.Warp).ToString(System.Globalization.CultureInfo.InvariantCulture),
                    a.Triggered ? "1" : "0",
                    a.GonogoId ?? ""));
            }
            return string.Join("\u001e", parts);
        }
    }

    /// <summary>The clock as <see cref="GameAlarmBoard.Build"/> lays it out.</summary>
    public sealed class GameAlarmBoardView
    {
        public bool Available { get; set; }

        /// <summary>Alarms every command centre sees at once.</summary>
        public List<GameAlarm> Plan { get; } = new List<GameAlarm>();

        /// <summary>Alarms worked out from a craft, by that craft's guid.</summary>
        public Dictionary<string, List<GameAlarm>> ByCraft { get; } =
            new Dictionary<string, List<GameAlarm>>(StringComparer.Ordinal);
    }
}
