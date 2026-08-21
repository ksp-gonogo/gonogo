using System;

namespace GonogoPrincipiaUplink
{
    /// <summary>
    /// The shared entry check for every gate below, kept in one place so that a
    /// gate nobody minted fails with an explanation rather than with a null
    /// dereference.
    ///
    /// <para>A <c>default</c> struct is the case this exists for. Every gate here
    /// is a struct so that it costs nothing to pass around, and a struct always
    /// has a zero value that carries no session and therefore no licence.</para>
    /// </summary>
    internal static class PrincipiaGateCheck
    {
        internal static IntPtr Enter(PrincipiaSession? session, int generation, string what)
        {
            if (session == null)
            {
                throw new PrincipiaProtocolException(
                    "Refusing to read " + what + ": this gate was never minted. A default gate is "
                    + "not a licence to read; obtain one from the frame that proves its "
                    + "precondition.");
            }
            return session.Enter(generation, what);
        }
    }

    /// <summary>
    /// One main-thread callback's worth of licence to talk to Principia.
    ///
    /// <para>Reads that need nothing but a live plugin handle live here. Anything
    /// touching a vessel goes through <see cref="TryVessel"/>, which is the only
    /// place <c>HasVessel</c> is called and the only source of a gate that the
    /// vessel-shaped reads will accept.</para>
    ///
    /// <para>Dispose it at the end of the callback. It is not holding a native
    /// resource; disposal is what ends the gates' validity at the end of the frame
    /// rather than at the start of the next one.</para>
    /// </summary>
    public sealed class PrincipiaFrame : IDisposable
    {
        private readonly PrincipiaSession _session;
        private readonly int _generation;

        internal PrincipiaFrame(PrincipiaSession session, int generation)
        {
            _session = session;
            _generation = generation;
        }

        /// <summary>Principia's own universal time, which is the clock every
        /// instant on this surface is expressed against.</summary>
        public double CurrentTime()
        {
            var handle = _session.Enter(_generation, "the plugin's current time");
            return _session.Plugin.CurrentTime(handle);
        }

        /// <summary>
        /// Asks Principia whether it still knows this vessel, and hands back the
        /// gate every vessel-shaped read requires.
        ///
        /// <para>False is the ordinary answer, not a fault: the vessel was
        /// recovered, decoupled and merged, or destroyed since we last enumerated,
        /// and a guid simply ageing between two of our ticks is the likeliest real
        /// mistake this whole layer exists to prevent. Drop the vessel and publish
        /// nothing for it. There is no "try anyway", because the failure is not an
        /// error return, it is the player's game ending.</para>
        /// </summary>
        public bool TryVessel(string? vesselGuid, out PrincipiaVesselGate vessel)
        {
            vessel = default;
            var handle = _session.Enter(_generation, "a vessel");
            if (string.IsNullOrEmpty(vesselGuid))
            {
                return false;
            }
            if (!_session.Plugin.HasVessel(handle, vesselGuid!))
            {
                return false;
            }
            vessel = new PrincipiaVesselGate(_session, _generation, vesselGuid!);
            return true;
        }

        public void Dispose() => _session.EndFrame(_generation);
    }

    /// <summary>
    /// A vessel Principia confirmed it knows, this frame.
    ///
    /// <para>Every read here routes through a native lookup that aborts on an
    /// unknown guid, which is why none of them is reachable except through
    /// <see cref="PrincipiaFrame.TryVessel"/>.</para>
    ///
    /// <para><b>One caveat that the analysis could not close.</b> The four
    /// kinematic reads take the back of the vessel's history without checking that
    /// it has one, and whether a vessel can be present but historyless (in the same
    /// frame it was inserted, before the integrator has advanced) could not be
    /// established from source. If it can, the failure there is silent corruption
    /// rather than a clean abort. It is recorded here rather than pretended
    /// away.</para>
    /// </summary>
    public readonly struct PrincipiaVesselGate
    {
        private readonly PrincipiaSession? _session;
        private readonly int _generation;
        private readonly string _guid;

        internal PrincipiaVesselGate(PrincipiaSession session, int generation, string guid)
        {
            _session = session;
            _generation = generation;
            _guid = guid;
        }

        /// <summary>The guid this gate was proved for, so a caller can label what
        /// it publishes without holding a second copy that might not match.</summary>
        public string Guid => _guid;

        public PrincipiaVector Velocity()
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "a vessel's velocity");
            return _session!.Plugin.VesselVelocity(handle, _guid);
        }

        /// <summary>
        /// The Frenet tangent, EXPRESSED IN THE PLAYER'S CURRENT PLOTTING FRAME.
        ///
        /// <para>So is the normal and so is the binormal. The number changes
        /// meaning when the player changes frame, which is why a frame qualifier
        /// travels with these wherever they are shown rather than being an optional
        /// extra on the readout.</para>
        /// </summary>
        public PrincipiaVector Tangent()
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "a vessel's tangent");
            return _session!.Plugin.VesselTangent(handle, _guid);
        }

        public PrincipiaVector Normal()
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "a vessel's normal");
            return _session!.Plugin.VesselNormal(handle, _guid);
        }

        public PrincipiaVector Binormal()
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "a vessel's binormal");
            return _session!.Plugin.VesselBinormal(handle, _guid);
        }

        /// <summary>The integrator settings behind this vessel's prediction, as
        /// Principia's own struct for the mapping layer to read.</summary>
        public object? PredictionAdaptiveStepParameters()
        {
            var handle = PrincipiaGateCheck.Enter(
                _session, _generation, "a vessel's prediction step parameters");
            return _session!.Plugin.VesselGetPredictionAdaptiveStepParameters(handle, _guid);
        }

        /// <summary>
        /// The orbit analyser's latest completed result, as Principia's own struct.
        ///
        /// <para>There is deliberately no way to ask for a ground-track recurrence.
        /// Supplying one means Principia constructs an <c>OrbitRecurrence</c> behind
        /// seven checks we would have to satisfy exactly, and the arithmetic that
        /// satisfies them was not solved. Passing nothing forfeits the recurrence
        /// and the equatorial crossings and removes all seven, which is the right
        /// trade and is made here once rather than at each call site.</para>
        ///
        /// <para>Null when the vessel has no analyser running, which is the normal
        /// state outside Principia's own main window.</para>
        /// </summary>
        public object? OrbitAnalysis(int groundTrackRevolution)
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "a vessel's orbit analysis");
            return _session!.Plugin.VesselGetAnalysis(handle, _guid, groundTrackRevolution);
        }

        /// <summary>How many flight plans this vessel holds, up to Principia's ten.</summary>
        public int FlightPlanCount()
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "a vessel's flight plan count");
            return _session!.Plugin.FlightPlanCount(handle, _guid);
        }

        /// <summary>Which of the vessel's plans is selected, or -1 when it has none.</summary>
        public int SelectedFlightPlan()
        {
            var handle = PrincipiaGateCheck.Enter(
                _session, _generation, "a vessel's selected flight plan");
            return _session!.Plugin.FlightPlanSelected(handle, _guid);
        }

        /// <summary>
        /// Asks whether this vessel has a flight plan at all, and hands back the
        /// gate every plan read requires.
        ///
        /// <para>False means publish "no flight plan", which is a different fact
        /// from an empty one and reads differently to an operator. Asking anyway
        /// aborts the process, and a count that was positive in an earlier frame is
        /// not an answer to this question.</para>
        /// </summary>
        public bool TryFlightPlan(out PrincipiaFlightPlanGate plan)
        {
            plan = default;
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "a vessel's flight plan");
            if (!_session!.Plugin.FlightPlanExists(handle, _guid))
            {
                return false;
            }
            plan = new PrincipiaFlightPlanGate(_session, _generation, _guid);
            return true;
        }
    }

    /// <summary>
    /// A flight plan Principia confirmed exists, this frame.
    ///
    /// <para>The burn reads are not on this type. They live on the tokens the two
    /// cursors yield, because an index is only safe against the count that was read
    /// in the same frame and the surest way to guarantee that is for the caller
    /// never to hold an index at all.</para>
    ///
    /// <para>The first read of a plan after a save is loaded materialises it
    /// synchronously on the main thread. It is idempotent and invisible to the
    /// player, but it is a frame spike, so do not do it during loading.</para>
    /// </summary>
    public readonly struct PrincipiaFlightPlanGate
    {
        private readonly PrincipiaSession? _session;
        private readonly int _generation;
        private readonly string _guid;

        internal PrincipiaFlightPlanGate(PrincipiaSession session, int generation, string guid)
        {
            _session = session;
            _generation = generation;
            _guid = guid;
        }

        public double InitialTime()
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "a plan's initial time");
            return _session!.Plugin.FlightPlanGetInitialTime(handle, _guid);
        }

        public double DesiredFinalTime()
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "a plan's desired final time");
            return _session!.Plugin.FlightPlanGetDesiredFinalTime(handle, _guid);
        }

        /// <summary>
        /// How far the plan actually integrated, which is short of the desired
        /// final time exactly when the plan is in trouble.
        ///
        /// <para>This is the one entry point in the family with no null check on
        /// the plugin handle of its own, so a null handle here is a segfault rather
        /// than a diagnosed abort. The re-read on every access is doing real work
        /// for this call in a way it is not for its neighbours.</para>
        /// </summary>
        public double ActualFinalTime()
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "a plan's actual final time");
            return _session!.Plugin.FlightPlanGetActualFinalTime(handle, _guid);
        }

        /// <summary>Principia's own account of why the plan failed to integrate,
        /// as its struct: an error code and the message that carries the remedy.</summary>
        public object? AnomalousStatus()
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "a plan's anomalous status");
            return _session!.Plugin.FlightPlanGetAnomalousStatus(handle, _guid);
        }

        public object? AdaptiveStepParameters()
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "a plan's step parameters");
            return _session!.Plugin.FlightPlanGetAdaptiveStepParameters(handle, _guid);
        }

        public int NumberOfAnomalousManoeuvres()
        {
            var handle = PrincipiaGateCheck.Enter(
                _session, _generation, "a plan's anomalous manoeuvre count");
            return _session!.Plugin.FlightPlanNumberOfAnomalousManoeuvres(handle, _guid);
        }

        /// <summary>
        /// The orbit analysis of one coast between burns, as Principia's own
        /// struct, or null when the coast index does not name one.
        ///
        /// <para>Out of range is the one place on this surface that answers null
        /// instead of aborting, so the coast index does not need a cursor of its
        /// own. The recurrence arguments are withheld for the same reason as on the
        /// vessel's analysis.</para>
        /// </summary>
        public object? CoastAnalysis(int coastIndex, int groundTrackRevolution)
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "a plan's coast analysis");
            return _session!.Plugin.FlightPlanGetCoastAnalysis(
                handle, _guid, groundTrackRevolution, coastIndex);
        }

        /// <summary>
        /// The plan's burns, bounded by a count read right now.
        ///
        /// <para>Iterating this is the only way to reach a burn read, and the burn
        /// token it yields cannot be constructed, stored usefully, or handed an
        /// index by the caller. The case that matters is the player deleting a burn
        /// between two of our frames: a token from the old frame is refused before
        /// it reaches the plugin, where the plugin would have aborted.</para>
        /// </summary>
        public PrincipiaManoeuvreCursor Manoeuvres()
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "a plan's manoeuvre count");
            var count = _session!.Plugin.FlightPlanNumberOfManoeuvres(handle, _guid);
            return new PrincipiaManoeuvreCursor(_session, _generation, _guid, count);
        }

        /// <summary>
        /// The burns' initial plotted velocities, which are a SEPARATE cursor
        /// because they are bounded by a different count.
        ///
        /// <para>That read indexes the plan's segments, not its burns, and it
        /// doubles the index before doing so, so the bound is <c>2i</c> against the
        /// segment count. Every other burn read is bounded by the manoeuvre count.
        /// Two bounds that differ by a factor of two on calls that otherwise look
        /// identical is exactly the thing that gets copy-pasted wrong, so the two
        /// are different types and neither loop can be handed the other's
        /// index.</para>
        ///
        /// <para>The manoeuvre count is read as well and taken as the tighter
        /// limit. The segment bound is what stops the abort; the manoeuvre bound is
        /// what stops the last entry being the final coast rather than a burn.</para>
        /// </summary>
        public PrincipiaPlottedVelocityCursor PlottedVelocities()
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "a plan's segment count");
            var segments = _session!.Plugin.FlightPlanNumberOfSegments(handle, _guid);
            var manoeuvres = _session.Plugin.FlightPlanNumberOfManoeuvres(handle, _guid);
            var withinSegments = segments <= 0 ? 0 : (segments + 1) / 2;
            var count = withinSegments < manoeuvres ? withinSegments : manoeuvres;
            return new PrincipiaPlottedVelocityCursor(_session, _generation, _guid, count < 0 ? 0 : count);
        }
    }

    /// <summary>
    /// The plan's burns, over a count captured in the frame that produced this
    /// cursor. Iterate it; there is no way to index into it.
    /// </summary>
    public readonly struct PrincipiaManoeuvreCursor
    {
        private readonly PrincipiaSession? _session;
        private readonly int _generation;
        private readonly string _guid;

        internal PrincipiaManoeuvreCursor(
            PrincipiaSession session, int generation, string guid, int count)
        {
            _session = session;
            _generation = generation;
            _guid = guid;
            Count = count;
        }

        /// <summary>How many burns the plan held when this cursor was made. Safe to
        /// publish as a number; it is not an index and buys no read.</summary>
        public int Count { get; }

        public Enumerator GetEnumerator() =>
            new Enumerator(_session, _generation, _guid, Count);

        public struct Enumerator
        {
            private readonly PrincipiaSession? _session;
            private readonly int _generation;
            private readonly string _guid;
            private readonly int _count;
            private int _index;

            internal Enumerator(
                PrincipiaSession? session, int generation, string guid, int count)
            {
                _session = session;
                _generation = generation;
                _guid = guid;
                _count = count;
                _index = -1;
            }

            public PrincipiaManoeuvreGate Current =>
                new PrincipiaManoeuvreGate(_session, _generation, _guid, _index);

            /// <summary>
            /// Advances, re-checking the frame each step rather than only at the
            /// start. A loop is the natural place for a yield to be added later,
            /// and the check is what turns that into a refusal instead of an abort.
            /// </summary>
            public bool MoveNext()
            {
                if (_index + 1 >= _count)
                {
                    return false;
                }
                PrincipiaGateCheck.Enter(_session, _generation, "the next manoeuvre");
                _index++;
                return true;
            }
        }
    }

    /// <summary>One burn of a plan, at an index this frame's own count licensed.</summary>
    public readonly struct PrincipiaManoeuvreGate
    {
        private readonly PrincipiaSession? _session;
        private readonly int _generation;
        private readonly string _guid;
        private readonly int _index;

        internal PrincipiaManoeuvreGate(
            PrincipiaSession? session, int generation, string guid, int index)
        {
            _session = session;
            _generation = generation;
            _guid = guid;
            _index = index;
        }

        /// <summary>Which burn of the plan this is, for labelling. Not an index
        /// into anything: no read on this surface accepts one.</summary>
        public int Ordinal => _index;

        /// <summary>
        /// The burn itself, as Principia's own struct.
        ///
        /// <para>A burn whose manoeuvring frame is not one of the four shapes
        /// Principia handles aborts inside this call, and there is no test for it in
        /// advance. It is not an incremental risk, the shipping burn editor reaches
        /// the same check on the same data, but a plan we cannot read is a plan we
        /// do not publish.</para>
        /// </summary>
        public object? Manoeuvre()
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "a manoeuvre");
            return _session!.Plugin.FlightPlanGetManoeuvre(handle, _guid, _index);
        }

        /// <summary>The burn's Frenet trihedron in world coordinates, as
        /// Principia's own struct.</summary>
        public object? FrenetTrihedron()
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "a manoeuvre's trihedron");
            return _session!.Plugin.FlightPlanGetManoeuvreFrenetTrihedron(handle, _guid, _index);
        }

        /// <summary>The guidance direction for this burn.</summary>
        public PrincipiaVector Guidance()
        {
            var handle = PrincipiaGateCheck.Enter(_session, _generation, "a manoeuvre's guidance");
            return _session!.Plugin.FlightPlanGetGuidance(handle, _guid, _index);
        }
    }

    /// <summary>
    /// The burns' initial plotted velocities, over the SEGMENT-derived count. Its
    /// separateness from <see cref="PrincipiaManoeuvreCursor"/> is the whole point of
    /// it; see <see cref="PrincipiaFlightPlanGate.PlottedVelocities"/>.
    /// </summary>
    public readonly struct PrincipiaPlottedVelocityCursor
    {
        private readonly PrincipiaSession? _session;
        private readonly int _generation;
        private readonly string _guid;

        internal PrincipiaPlottedVelocityCursor(
            PrincipiaSession session, int generation, string guid, int count)
        {
            _session = session;
            _generation = generation;
            _guid = guid;
            Count = count;
        }

        public int Count { get; }

        public Enumerator GetEnumerator() =>
            new Enumerator(_session, _generation, _guid, Count);

        public struct Enumerator
        {
            private readonly PrincipiaSession? _session;
            private readonly int _generation;
            private readonly string _guid;
            private readonly int _count;
            private int _index;

            internal Enumerator(
                PrincipiaSession? session, int generation, string guid, int count)
            {
                _session = session;
                _generation = generation;
                _guid = guid;
                _count = count;
                _index = -1;
            }

            public PrincipiaPlottedVelocityGate Current =>
                new PrincipiaPlottedVelocityGate(_session, _generation, _guid, _index);

            public bool MoveNext()
            {
                if (_index + 1 >= _count)
                {
                    return false;
                }
                PrincipiaGateCheck.Enter(_session, _generation, "the next plotted velocity");
                _index++;
                return true;
            }
        }
    }

    /// <summary>One burn's initial plotted velocity, at an index the segment count
    /// licensed.</summary>
    public readonly struct PrincipiaPlottedVelocityGate
    {
        private readonly PrincipiaSession? _session;
        private readonly int _generation;
        private readonly string _guid;
        private readonly int _index;

        internal PrincipiaPlottedVelocityGate(
            PrincipiaSession? session, int generation, string guid, int index)
        {
            _session = session;
            _generation = generation;
            _guid = guid;
            _index = index;
        }

        /// <summary>Which burn this velocity belongs to, so a caller can pair it
        /// with the matching entry of the manoeuvre cursor.</summary>
        public int Ordinal => _index;

        public PrincipiaVector InitialPlottedVelocity()
        {
            var handle = PrincipiaGateCheck.Enter(
                _session, _generation, "a manoeuvre's initial plotted velocity");
            return _session!.Plugin.FlightPlanGetManoeuvreInitialPlottedVelocity(
                handle, _guid, _index);
        }
    }
}
