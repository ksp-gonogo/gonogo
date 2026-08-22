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

        /// <summary>
        /// Whether the WRITE half of this surface bound, and why not when it did
        /// not.
        ///
        /// <para>Separate from binding at all, deliberately. A build whose write
        /// entry points are not the shape they were analysed in must still be
        /// readable: a read misfire is a wrong number on a screen, a write misfire
        /// is a corrupted save. So the write half fails closed on its own and
        /// leaves everything above it publishing.</para>
        /// </summary>
        bool WritesBound(out string reason);

        /// <summary>
        /// The manoeuvre index the producer's optimiser is working on, or -1 when
        /// no optimisation is running.
        ///
        /// <para>A read, on the write surface, because it exists only to keep a
        /// write from being silently reverted. Its preconditions are stricter than
        /// any other plan read's: it needs the plan to have been MATERIALISED in
        /// this frame, because the native body reaches into the plan's variant with
        /// no deserialisation test.</para>
        /// </summary>
        int FlightPlanOptimizationDriverInProgress(IntPtr plugin, string vesselGuid);

        /// <summary>
        /// Inserts <paramref name="burn"/> at <paramref name="index"/>, which may
        /// equal the manoeuvre count (that appends). Returns the producer's own
        /// status object.
        /// </summary>
        object? FlightPlanInsert(IntPtr plugin, string vesselGuid, object burn, int index);

        /// <summary>
        /// Replaces the burn at <paramref name="index"/>, which must be strictly
        /// less than the manoeuvre count. The bound differs from
        /// <see cref="FlightPlanInsert"/>'s by exactly one and the difference is a
        /// clean abort rather than an error return.
        /// </summary>
        object? FlightPlanReplace(IntPtr plugin, string vesselGuid, object burn, int index);

        object? FlightPlanRemove(IntPtr plugin, string vesselGuid, int index);

        object? FlightPlanSetDesiredFinalTime(IntPtr plugin, string vesselGuid, double finalTime);

        /// <summary>
        /// Writes back a step-parameter struct that came OUT of
        /// <see cref="FlightPlanGetAdaptiveStepParameters"/>. There is deliberately
        /// no overload that takes the five values: two of them are integrator kinds
        /// from disjoint sets, and supplying the wrong one aborts with no message.
        /// </summary>
        object? FlightPlanSetAdaptiveStepParameters(
            IntPtr plugin, string vesselGuid, object parameters);

        /// <summary>
        /// Creates a plan and selects it. Reports nothing: re-read the plan to find
        /// out what happened. <paramref name="finalTime"/> before the vessel's
        /// present is an assertion failure inside the producer, not an error.
        /// </summary>
        void FlightPlanCreate(IntPtr plugin, string vesselGuid, double finalTime, double massInTonnes);

        /// <summary>
        /// Deletes the selected plan. <b>On a vessel with no plan this is undefined
        /// behaviour rather than a diagnosed abort</b>, and the producer's own
        /// header comment promises the opposite. Never reachable except through the
        /// gate that has just proved a plan exists.
        /// </summary>
        void FlightPlanDelete(IntPtr plugin, string vesselGuid);

        void FlightPlanDuplicate(IntPtr plugin, string vesselGuid);
    }
}
