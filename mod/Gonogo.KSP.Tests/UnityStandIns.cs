using System;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.CompilerServices;
using CommNet;
using Sitrep.Host.Comms;
using UnityEngine;

namespace Gonogo.KSP.Tests
{
    /// <summary>
    /// KSP objects and statics for a test that drives glue code headlessly: the
    /// clock, a craft and its link, the comms config and a log that does not
    /// reach the engine. <c>FlightGlobals</c> is not among them: its static
    /// initialiser throws outside the engine, so code under test is handed the
    /// vessel list rather than reading it.
    ///
    /// <para>A Unity object built without its constructor compares equal to
    /// null, because Unity's equality asks whether the native object behind it
    /// is alive. <see cref="Alive{T}"/> marks it alive by giving it a native
    /// pointer, which nothing here ever dereferences; that is what lets
    /// <c>Planetarium.fetch</c> answer.</para>
    ///
    /// <para>Every one of these is process state, so a class that uses them
    /// joins the <see cref="Comms.CommsCoreUplinkStatics"/> collection and runs
    /// alone.</para>
    /// </summary>
    internal sealed class UnityStandIns : IDisposable
    {
        private static readonly FieldInfo CachedPtr =
            typeof(UnityEngine.Object).GetField("m_CachedPtr", BindingFlags.NonPublic | BindingFlags.Instance)!;

        private readonly ILogHandler _previousLog;
        private readonly SignalDelayConfig _previousConfig;
        private readonly DelayModifiers _previousModifiers;

        /// <summary>Every warning the code under test logged.</summary>
        internal List<string> Logged { get; } = new List<string>();

        internal UnityStandIns(double ut, SignalDelayConfig config)
        {
            _previousLog = Debug.unityLogger.logHandler;
            Debug.unityLogger.logHandler = new Recorder(Logged);

            var planetarium = Alive<Planetarium>();
            planetarium.time = ut;
            Planetarium.fetch = planetarium;

            _previousConfig = CommsCoreUplink.AuthoredSignalDelayConfig;
            _previousModifiers = CommsCoreUplink.DelayModifiersInForce;
            CommsCoreUplink.UseDelayModifiers(new DelayModifiers());
            CommsCoreUplink.ConfigureCommsModelProbe(() => true);
            CommsCoreUplink.ConfigureSignalDelay(config);
        }

        /// <summary>Moves the game clock.</summary>
        internal double Ut
        {
            set => Planetarium.fetch.time = value;
        }

        /// <summary>A Unity object with no engine behind it that Unity's own null checks treat as alive.</summary>
        internal static T Alive<T>() where T : UnityEngine.Object
        {
            var built = (T)RuntimeHelpers.GetUninitializedObject(typeof(T));
            CachedPtr.SetValue(built, new IntPtr(1));
            return built;
        }

        /// <summary>A craft with the given id and link, or no link object at all.</summary>
        internal static Vessel Craft(Guid id, CommNetVessel? link = null, VesselType type = VesselType.Probe)
        {
            var vessel = Alive<Vessel>();
            vessel.id = id;
            vessel.vesselType = type;
            vessel.connection = link!;
            return vessel;
        }

        /// <summary>A craft's link: connected or not, over the given hops (none is an empty control path).</summary>
        internal static CommNetVessel Link(bool connected, params CommLink[] hops)
        {
            var link = Alive<CommNetVessel>();
            typeof(CommNetVessel).GetField("<IsConnected>k__BackingField", BindingFlags.NonPublic | BindingFlags.Instance)!
                .SetValue(link, connected);
            var path = new CommPath();
            foreach (var hop in hops)
            {
                path.Add(hop);
            }
            typeof(CommNetVessel).GetField("controlPath", BindingFlags.NonPublic | BindingFlags.Instance)!
                .SetValue(link, path);
            return link;
        }

        /// <summary>One hop between two points this far apart, ending at home or not.</summary>
        internal static CommLink Hop(double meters, bool endsAtHome)
        {
            var from = new CommNode { precisePosition = new Vector3d(0.0, 0.0, 0.0) };
            var to = new CommNode { precisePosition = new Vector3d(meters, 0.0, 0.0), isHome = endsAtHome };
            return new CommLink { a = from, b = to };
        }

        public void Dispose()
        {
            CommsCoreUplink.ConfigureSignalDelay(_previousConfig);
            CommsCoreUplink.UseDelayModifiers(_previousModifiers);
            CommsCoreUplink.ConfigureCommsModelProbe(null);
            Planetarium.fetch = null!;
            Debug.unityLogger.logHandler = _previousLog;
        }

        private sealed class Recorder : ILogHandler
        {
            private readonly List<string> _into;

            internal Recorder(List<string> into) => _into = into;

            public void LogFormat(LogType logType, UnityEngine.Object context, string format, params object[] args) =>
                _into.Add(args.Length == 0 ? format : string.Format(format, args));

            public void LogException(Exception exception, UnityEngine.Object context) =>
                _into.Add(exception.ToString());
        }
    }
}
