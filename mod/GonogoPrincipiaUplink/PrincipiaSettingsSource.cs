using System;
using HarmonyLib;
using UnityEngine;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// Finds the producer's addon, binds its plugin once, and hands the settings
    /// reading everything it cannot work out for itself.
    ///
    /// <para><b>There is no render patch here, and its absence is the point.</b>
    /// The prediction tolerance and step count used to arrive through a Harmony
    /// postfix on the producer's settings window, because the fields that hold
    /// them are indices its UI recomputes on every repaint. Reading the plugin's
    /// own per-vessel parameters answers the same question directly, so the patch
    /// is gone: the numbers now work from the first tick instead of from the first
    /// time an operator happened to open a window, they are that VESSEL's bound
    /// rather than the last global slider position, and this Uplink patches
    /// nothing at all on the settings path.</para>
    ///
    /// <para>The addon derives from a behaviour, so the engine's own scene lookup
    /// finds it with no hook and no knowledge of the producer beyond a type name.
    /// Everything below is a lookup; every decision about what to publish lives
    /// where a test can drive it.</para>
    /// </summary>
    public sealed class PrincipiaSettingsSource : ISettingsSource
    {
        private const string AdapterTypeName = "principia.ksp_plugin_adapter.PrincipiaPluginAdapter";

        private const string MainWindowField = "main_window_";
        private const string FrameSelectorField = "plotting_frame_selector_";
        private const string FlightPlannerField = "flight_planner_";
        private const string OrbitAnalyserField = "orbit_analyser_";
        private const string PredictedVesselMember = "predicted_vessel";
        private const string VesselIdMember = "id";

        private static readonly ReflectedMembers Members = new ReflectedMembers();

        private object? _adapter;
        private PrincipiaSession? _session;
        private bool _sessionRefused;

        public bool Attached { get; private set; }

        public object? MainWindow => Members.Value(Adapter(), MainWindowField);

        public object? FrameSelector => Members.Value(Adapter(), FrameSelectorField);

        public object? FlightPlanner => Members.Value(Adapter(), FlightPlannerField);

        public object? OrbitAnalyser => Members.Value(Adapter(), OrbitAnalyserField);

        public ICelestialNames Celestials { get; } = new FlightGlobalsCelestials();

        /// <summary>
        /// The bound session, or null.
        ///
        /// <para>Bound lazily and at most once per refusal, because the version
        /// gate's answer does not change within a session and re-asking it every
        /// tick would turn a stated outage into a log flood. It IS retried while
        /// the answer is "no plugin yet": the addon exists before the plugin does,
        /// so a bind attempted at the main menu has to be allowed to succeed
        /// later.</para>
        /// </summary>
        public PrincipiaSession? Session
        {
            get
            {
                if (_session != null || _sessionRefused)
                {
                    return _session;
                }
                if (!PrincipiaSession.TryBindLive(out var session, out var reason))
                {
                    // "Not loaded" is an ordinary state that resolves itself; a
                    // version refusal is permanent for this session and is said
                    // once.
                    if (reason.IndexOf("not analysed", StringComparison.Ordinal) >= 0)
                    {
                        _sessionRefused = true;
                        Debug.LogWarning("[Gonogo] Principia settings unavailable: " + reason);
                    }
                    return null;
                }
                _session = session;
                return _session;
            }
        }

        /// <summary>
        /// The vessel the producer's own windows are talking about.
        ///
        /// <para>Read off the producer rather than from the game's active vessel,
        /// and the difference matters twice: it falls back to the tracking
        /// station's selection when there is no active vessel, and it has already
        /// asked the plugin whether the vessel is one it knows. Taking the game's
        /// active vessel instead would attribute one craft's integrator bound to
        /// whichever craft the map happened to be showing.</para>
        /// </summary>
        public string? ActiveVesselGuid
        {
            get
            {
                var window = MainWindow;
                var vessel = window == null ? null : Members.Value(window, PredictedVesselMember);
                var id = vessel == null ? null : Members.Value(vessel, VesselIdMember);
                var text = id?.ToString();
                return string.IsNullOrEmpty(text) ? null : text;
            }
        }

        public string? TargetCelestialBody
        {
            get
            {
                var target = FlightGlobals.fetch == null ? null : FlightGlobals.fetch.VesselTarget;
                return target is CelestialBody body ? body.bodyName : null;
            }
        }

        /// <summary>Finds the addon, or answers false and is asked again next
        /// tick. Nothing is patched, so there is nothing to undo.</summary>
        public bool TryAttach()
        {
            if (Attached)
            {
                return true;
            }
            try
            {
                Attached = Adapter() != NotFound;
                return Attached;
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] PrincipiaSettingsSource.TryAttach failed: " + ex.Message);
                return false;
            }
        }

        private object Adapter()
        {
            if (_adapter != null)
            {
                return _adapter;
            }
            var adapterType = AccessTools.TypeByName(AdapterTypeName);
            if (adapterType != null)
            {
                _adapter = UnityEngine.Object.FindObjectOfType(adapterType);
            }
            // A sentinel rather than null so the member reads above stay
            // unconditional: reading a name off a bare object simply misses.
            return _adapter ?? NotFound;
        }

        private static readonly object NotFound = new object();

        /// <summary>
        /// The game's body table, by the index the producer uses to name the bodies
        /// in a frame.
        ///
        /// <para>Searched rather than indexed. The game's list is in index order in
        /// practice and the producer relies on that, but a frame descriptor holding
        /// an index we cannot account for should name no body rather than the wrong
        /// one, and a mismatched name is not a mistake anyone downstream could
        /// catch.</para>
        /// </summary>
        private sealed class FlightGlobalsCelestials : ICelestialNames
        {
            public string? NameOf(int index)
            {
                if (index < 0 || FlightGlobals.Bodies == null)
                {
                    return null;
                }
                foreach (var body in FlightGlobals.Bodies)
                {
                    if (body != null && body.flightGlobalsIndex == index)
                    {
                        return body.bodyName;
                    }
                }
                return null;
            }
        }
    }
}
