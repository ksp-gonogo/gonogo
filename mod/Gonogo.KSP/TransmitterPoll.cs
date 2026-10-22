using System;
using System.Collections.Generic;
using System.Reflection;
using Sitrep.Host.Science;

namespace Gonogo.KSP
{
    /// <summary>
    /// What the active vessel's transmitters showed on one tick, and what the vessel holds unsent.
    /// Plain data, handed from the game thread to the courier.
    /// </summary>
    internal sealed class TransmitterPollCapture
    {
        public double Ut { get; set; }
        public List<TransmitterReading> Readings { get; } = new List<TransmitterReading>();
        public List<QueuedData> Aboard { get; } = new List<QueuedData>();
    }

    /// <summary>
    /// Reads the active vessel's stock data transmitters each tick so a transmission started
    /// anywhere (the game's own button, a script, the lab) is seen, not only one a command
    /// started.
    ///
    /// <para>A transmitter's queue and abort flag are protected fields, read by reflection here
    /// and nowhere else. If a game update renames them the read fails soft: the transmitter is
    /// still seen going busy and idle, and its transmission is reported with no title.</para>
    ///
    /// <para>Threading: reads live KSP state, MAIN-THREAD only.</para>
    /// </summary>
    internal static class TransmitterPoll
    {
        private static readonly FieldInfo? QueueField = Field("transmissionQueue");
        private static readonly FieldInfo? AbortedField = Field("xmitAborted");
        private static bool _readFailureLogged;

        private static FieldInfo? Field(string name) =>
            typeof(ModuleDataTransmitter).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public);

        /// <summary>
        /// The capture for this tick. <paramref name="holdsRun"/> says whether a transmission is
        /// already being followed, which is when what the vessel holds is worth reading.
        /// </summary>
        internal static TransmitterPollCapture CaptureOnMain(double ut, bool holdsRun)
        {
            var capture = new TransmitterPollCapture { Ut = ut };
            var vessel = ActiveVesselScope.Current;
            if (vessel == null || vessel.parts == null)
            {
                return capture;
            }

            var anyBusy = false;
            foreach (var part in vessel.parts)
            {
                if (part == null || part.Modules == null)
                {
                    continue;
                }

                var index = 0;
                foreach (var transmitter in part.Modules.GetModules<ModuleDataTransmitter>())
                {
                    var busy = transmitter.IsBusy();
                    anyBusy |= busy;
                    capture.Readings.Add(new TransmitterReading(
                        part.flightID + ":" + index++,
                        busy,
                        busy && ReadAborted(transmitter),
                        busy ? ReadQueue(transmitter) : Array.Empty<QueuedData>()));
                }
            }

            if (anyBusy || holdsRun)
            {
                ReadAboard(vessel, capture.Aboard);
            }

            return capture;
        }

        private static bool ReadAborted(ModuleDataTransmitter transmitter)
        {
            try
            {
                return AbortedField != null && AbortedField.GetValue(transmitter) is bool aborted && aborted;
            }
            catch (Exception ex)
            {
                LogReadFailure(ex);
                return false;
            }
        }

        private static IReadOnlyList<QueuedData> ReadQueue(ModuleDataTransmitter transmitter)
        {
            try
            {
                if (QueueField?.GetValue(transmitter) is not List<ScienceData> queue)
                {
                    LogReadFailure(null);
                    return Array.Empty<QueuedData>();
                }

                var items = new List<QueuedData>(queue.Count);
                foreach (var data in queue)
                {
                    if (data != null)
                    {
                        items.Add(Describe(data));
                    }
                }
                return items;
            }
            catch (Exception ex)
            {
                LogReadFailure(ex);
                return Array.Empty<QueuedData>();
            }
        }

        private static void ReadAboard(Vessel vessel, List<QueuedData> into)
        {
            foreach (var part in vessel.parts)
            {
                if (part == null || part.Modules == null)
                {
                    continue;
                }

                foreach (var experiment in part.Modules.GetModules<ModuleScienceExperiment>())
                {
                    AddAll(experiment.GetData(), into);
                }

                foreach (var container in part.Modules.GetModules<ModuleScienceContainer>())
                {
                    AddAll(container.GetData(), into);
                }
            }
        }

        private static void AddAll(ScienceData[]? data, List<QueuedData> into)
        {
            if (data == null)
            {
                return;
            }

            foreach (var item in data)
            {
                if (item != null)
                {
                    into.Add(Describe(item));
                }
            }
        }

        private static QueuedData Describe(ScienceData data) =>
            new QueuedData(data, data.subjectID, data.title, data.dataAmount);

        /// <summary>The first failure is logged and every later one is not, since the poll runs every tick.</summary>
        private static void LogReadFailure(Exception? ex)
        {
            if (_readFailureLogged)
            {
                return;
            }

            _readFailureLogged = true;
            GonogoLog.Warn(
                "TransmitterPoll",
                "a transmitter's queue could not be read (" + (ex?.GetType().Name ?? "field missing") + "); transmissions started in the game are reported without a title");
        }
    }
}
