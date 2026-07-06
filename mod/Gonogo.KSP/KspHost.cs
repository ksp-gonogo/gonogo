using System;
using System.Collections.Generic;
using Sitrep.Host;
using UnityEngine;

namespace Gonogo.KSP
{
    /// <summary>
    /// The ONLY class in the mod that touches KSP/Unity APIs directly (see
    /// <see cref="IKspHost"/>'s doc comment for the boundary this enforces).
    /// Every public member either returns a primitive/POCO or fires
    /// <see cref="Lifecycle"/> with one — no <c>CelestialBody</c>/<c>Vessel</c>/
    /// <c>Orbit</c> reference ever escapes through this type.
    ///
    /// KSP calls happen ONLY here and from <see cref="GonogoAddon"/>'s
    /// <c>FixedUpdate</c>/GameEvents callbacks (both main-thread) - the
    /// courier/transport/recorder machinery downstream of <see cref="Sample"/>
    /// never touches a KSP type.
    ///
    /// <para><b>KSP-API surprises found via decompile (see the M5b Task 4b
    /// report for detail):</b></para>
    /// <list type="bullet">
    /// <item><description><c>CelestialBody.referenceBody</c> returns the body
    /// ITSELF (not <c>null</c>) when it has no <c>orbitDriver</c> - i.e. for
    /// the sun. <c>orbit</c> is genuinely <c>null</c> in that case though.
    /// So "is this the root star" is detected via
    /// <c>ReferenceEquals(refBody, body)</c>, not a null check.</description></item>
    /// <item><description><c>FlightGlobals.fetch</c> can itself be
    /// <c>null</c> (it's a lazy <c>FindObjectOfType</c> singleton) before any
    /// scene has spawned it, e.g. very early at the main menu -
    /// <c>FlightGlobals.Bodies</c> would NRE on that <c>fetch.bodies</c>
    /// dereference. Guarded below with <c>FlightGlobals.ready &amp;&amp;
    /// FlightGlobals.fetch != null</c> before ever touching
    /// <c>FlightGlobals.Bodies</c>.</description></item>
    /// </list>
    /// </summary>
    public sealed class KspHost : IKspHost
    {
        public event Action<KspLifecycleEvent> Lifecycle = delegate { };

        public KspHost()
        {
            GameEvents.onGameSceneLoadRequested.Add(OnGameSceneLoadRequested);
            GameEvents.onFlightReady.Add(OnFlightReady);
            GameEvents.onVesselChange.Add(OnVesselChange);
            GameEvents.onGameStateLoad.Add(OnGameStateLoad);
        }

        /// <summary>Unsubscribes from every <see cref="GameEvents"/> hook. Call from <see cref="GonogoAddon"/>'s teardown - GameEvents are static/global, so a leaked subscription would outlive this instance.</summary>
        public void Unhook()
        {
            GameEvents.onGameSceneLoadRequested.Remove(OnGameSceneLoadRequested);
            GameEvents.onFlightReady.Remove(OnFlightReady);
            GameEvents.onVesselChange.Remove(OnVesselChange);
            GameEvents.onGameStateLoad.Remove(OnGameStateLoad);
        }

        /// <summary>
        /// Current UT. <see cref="Planetarium.GetUniversalTime"/> already
        /// falls back to <c>HighLogic.CurrentGame.UniversalTime</c> when
        /// <c>Planetarium.fetch</c> is null (decompiled and confirmed), but
        /// this still wraps in try/catch: a FixedUpdate-driven caller must
        /// never throw, and the fallback path itself touches
        /// <c>HighLogic.CurrentGame</c>, which can be null before any save
        /// is loaded.
        /// </summary>
        public double NowUt()
        {
            try
            {
                return Planetarium.GetUniversalTime();
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] NowUt() failed, returning 0: " + ex);
                return 0;
            }
        }

        /// <summary>
        /// Primitives-only snapshot of every celestial body FlightGlobals
        /// currently knows about. Returns an empty snapshot (no "bodies" key)
        /// when nothing is loaded yet (main menu) rather than throwing -
        /// see the class doc comment for the <c>FlightGlobals.fetch</c> guard.
        /// </summary>
        public KspSnapshot Sample()
        {
            var ut = NowUt();
            var values = new Dictionary<string, object?>();

            try
            {
                if (FlightGlobals.ready && FlightGlobals.fetch != null)
                {
                    var bodies = FlightGlobals.Bodies;
                    if (bodies != null && bodies.Count > 0)
                    {
                        var list = new List<object?>(bodies.Count);
                        foreach (var body in bodies)
                        {
                            if (body == null)
                            {
                                continue;
                            }
                            list.Add(BuildBodyEntry(body));
                        }
                        values["bodies"] = list;
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] Sample() failed, returning a degraded snapshot: " + ex);
            }

            return new KspSnapshot { Ut = ut, Values = values };
        }

        /// <summary>
        /// Raw per-body dictionary in the exact shape
        /// <c>Sitrep.Host.SystemViewProvider.BuildSystemBodies</c> expects
        /// (see that class's doc comment) - primitives only, keyed exactly:
        /// name/index/parentIndex/radius/sma/ecc/inc/lan/argPe/
        /// meanAnomalyAtEpoch/epoch.
        /// </summary>
        private static Dictionary<string, object?> BuildBodyEntry(CelestialBody body)
        {
            var refBody = body.referenceBody;
            // See the class doc comment: referenceBody returns the body
            // ITSELF (never null) when there's no orbitDriver - the sun.
            var isRoot = refBody == null || ReferenceEquals(refBody, body);
            int? parentIndex = isRoot ? (int?)null : refBody!.flightGlobalsIndex;

            var entry = new Dictionary<string, object?>
            {
                ["name"] = body.bodyName,
                ["index"] = body.flightGlobalsIndex,
                ["parentIndex"] = parentIndex,
                ["radius"] = body.Radius,
            };

            var orbit = body.orbit;
            if (!isRoot && orbit != null)
            {
                entry["sma"] = orbit.semiMajorAxis;
                entry["ecc"] = orbit.eccentricity;
                entry["inc"] = orbit.inclination;
                entry["lan"] = orbit.LAN;
                entry["argPe"] = orbit.argumentOfPeriapsis;
                entry["meanAnomalyAtEpoch"] = orbit.meanAnomalyAtEpoch;
                entry["epoch"] = orbit.epoch;
            }

            return entry;
        }

        // ----------------------------------------------------------------
        // GameEvents -> Lifecycle
        // ----------------------------------------------------------------

        private void OnGameSceneLoadRequested(GameScenes scene)
        {
            Emit("scene-load", new Dictionary<string, object?> { ["scene"] = scene.ToString() });
        }

        private void OnFlightReady()
        {
            Emit("flight-ready", new Dictionary<string, object?>());
        }

        private void OnVesselChange(Vessel vessel)
        {
            Emit("vessel-change", new Dictionary<string, object?>
            {
                ["vesselId"] = vessel != null ? vessel.id.ToString() : null,
                ["vesselName"] = vessel != null ? vessel.vesselName : null,
            });
        }

        private void OnGameStateLoad(ConfigNode node)
        {
            // Fired for both a fresh load and a quickload (F9) - the recorder
            // doesn't need to (and can't cheaply) distinguish the two; the
            // replay side treats every "game-state-load" as a timeline
            // rewind point.
            Emit("game-state-load", new Dictionary<string, object?>());
        }

        private void Emit(string kind, Dictionary<string, object?> args)
        {
            try
            {
                Lifecycle.Invoke(new KspLifecycleEvent { Ut = NowUt(), Kind = kind, Args = args });
            }
            catch (Exception ex)
            {
                Debug.LogWarning("[Gonogo] Lifecycle handler for \"" + kind + "\" threw: " + ex);
            }
        }
    }
}
