using System;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// A triple of doubles as Principia hands them back, decoded from its
    /// <c>XYZ</c> so that nothing above this layer has to know that type exists.
    /// </summary>
    public readonly struct PrincipiaVector
    {
        public PrincipiaVector(double x, double y, double z)
        {
            X = x;
            Y = y;
            Z = z;
        }

        public double X { get; }
        public double Y { get; }
        public double Z { get; }
    }

    /// <summary>
    /// Where the live plugin handle comes from, re-read on demand rather than
    /// held.
    ///
    /// <para>The handle is a raw pointer that Principia REPLACES on deserialise
    /// and on a plugin reset, so a cached copy is a dangling pointer with a
    /// perfectly ordinary-looking type. Nothing here ever stores one across a
    /// call, which is why this is an interface with one method rather than a
    /// field someone could read once.</para>
    /// </summary>
    internal interface IPrincipiaPluginHandle
    {
        /// <summary>The handle as it stands right now, or <c>IntPtr.Zero</c> when
        /// there is no plugin (main menu, mid-reset, mod absent).</summary>
        IntPtr Current();
    }

    /// <summary>
    /// The complete set of Principia calls this Uplink may make, and the only
    /// place any of them is named.
    ///
    /// <para><b>This interface carries no safety of its own, deliberately.</b>
    /// Every method here maps one-to-one onto a native entry point that aborts the
    /// KSP process on bad input, and none of them checks anything. The safety
    /// lives entirely in <see cref="PrincipiaSession"/> and the gate types that
    /// hang off it, which are the only holders of an implementation. Splitting it
    /// this way is what lets a test drive the protocol against a double that
    /// records the call order and faults on an unlicensed read, which a
    /// self-guarding port could not be made to do.</para>
    ///
    /// <para>Two shapes are worth noticing. The analysis calls take no recurrence
    /// arguments, because both of Principia's must be null and must agree, and a
    /// parameter that may only ever hold one value is better not offered: the
    /// implementation passes the nulls and the caller cannot get it wrong. And the
    /// interchange structs come back as <c>object</c> rather than decoded, because
    /// decoding them is the mapping layer's work and this layer's contract is
    /// narrower: the call was legal, it was made in a licensed order, and here is
    /// what it returned.</para>
    /// </summary>
    internal interface IPrincipiaPlugin
    {
        /// <summary>
        /// The build string the whole binding is keyed to. Takes no handle and has
        /// no preconditions, which is why it can be the first thing called.
        /// False when the call could not be made at all.
        /// </summary>
        bool GetVersion(out string? buildDate, out string? version, out string? platform);

        double CurrentTime(IntPtr plugin);

        /// <summary>
        /// The only call on this surface that tolerates a guid we have not just
        /// proved. Everything else routes through a lookup that aborts on a miss.
        /// </summary>
        bool HasVessel(IntPtr plugin, string vesselGuid);

        PrincipiaVector VesselVelocity(IntPtr plugin, string vesselGuid);
        PrincipiaVector VesselTangent(IntPtr plugin, string vesselGuid);
        PrincipiaVector VesselNormal(IntPtr plugin, string vesselGuid);
        PrincipiaVector VesselBinormal(IntPtr plugin, string vesselGuid);
        object? VesselGetPredictionAdaptiveStepParameters(IntPtr plugin, string vesselGuid);
        object? VesselGetAnalysis(IntPtr plugin, string vesselGuid, int groundTrackRevolution);

        bool FlightPlanExists(IntPtr plugin, string vesselGuid);
        int FlightPlanCount(IntPtr plugin, string vesselGuid);
        int FlightPlanSelected(IntPtr plugin, string vesselGuid);

        double FlightPlanGetInitialTime(IntPtr plugin, string vesselGuid);
        double FlightPlanGetDesiredFinalTime(IntPtr plugin, string vesselGuid);
        double FlightPlanGetActualFinalTime(IntPtr plugin, string vesselGuid);
        object? FlightPlanGetAnomalousStatus(IntPtr plugin, string vesselGuid);
        object? FlightPlanGetAdaptiveStepParameters(IntPtr plugin, string vesselGuid);
        int FlightPlanNumberOfManoeuvres(IntPtr plugin, string vesselGuid);
        int FlightPlanNumberOfSegments(IntPtr plugin, string vesselGuid);
        int FlightPlanNumberOfAnomalousManoeuvres(IntPtr plugin, string vesselGuid);
        object? FlightPlanGetCoastAnalysis(
            IntPtr plugin, string vesselGuid, int groundTrackRevolution, int coastIndex);

        object? FlightPlanGetManoeuvre(IntPtr plugin, string vesselGuid, int index);
        object? FlightPlanGetManoeuvreFrenetTrihedron(IntPtr plugin, string vesselGuid, int index);
        PrincipiaVector FlightPlanGetGuidance(IntPtr plugin, string vesselGuid, int index);
        PrincipiaVector FlightPlanGetManoeuvreInitialPlottedVelocity(
            IntPtr plugin, string vesselGuid, int index);
    }
}
