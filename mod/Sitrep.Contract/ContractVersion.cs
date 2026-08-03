namespace Sitrep.Contract
{
    /// <summary>
    /// The Uplink ABI's version: see
    /// <c>local_docs/telemetry-mod/uplink-versioning-research.md</c>. This is
    /// intentionally a bare <c>const int</c> pair, not a struct/semver type:
    /// every consumer that needs "what contract version was I built against"
    /// (see <see cref="SitrepUplinkAttribute"/>'s default constructor
    /// arguments) relies on the C# compiler inlining a <c>const</c> at the
    /// CALL SITE, at COMPILE time: a struct/property read would instead
    /// resolve against the CALLER's loaded copy of this assembly, defeating
    /// the whole point of stamping "what version this Uplink was built
    /// against" into an old, un-recompiled binary.
    ///
    /// <see cref="Major"/> bumps are BREAKING (removed/renamed/retyped
    /// members on a wire-visible <c>[TsInterface]</c> type: the CI "lying
    /// minor" gate, see <c>local_docs/telemetry-mod/uplink-versioning-research.md</c>,
    /// fails the build on exactly this unless <see cref="Major"/> bumps in
    /// the same commit). <see cref="Minor"/> bumps are additive-only (new
    /// field/type) and never break an Uplink built against an older Minor of
    /// the same Major.
    /// </summary>
    public static class ContractVersion
    {
        /// <summary>
        /// Bumped 3 -&gt; 4 (Minor reset to 0). The Major-4 line carries TWO
        /// breaking retypes, deliberately collapsed into ONE Major because
        /// v4 was never released and there are no external Uplinks: no
        /// artifact was ever built against an intermediate v4 shape, so there
        /// is exactly one v4 anyone will ever see, the merged one below. A
        /// Major is only meaningful if it names exactly one shape, and this
        /// one does. Both are sanctioned wire retypes on the same standing
        /// grounds as the Major 2 -&gt; 3 revert: the mod is still pre-release
        /// with NO external Uplinks yet.
        ///
        /// <para>(1) NAMED action groups. Retyped
        /// <see cref="VesselControl.ActionGroups"/> from a positional
        /// <c>bool[]</c> (<c>[ag1..ag10]</c>, identity carried by array
        /// POSITION) to <see cref="ActionGroupState"/><c>[]</c>, where each
        /// entry carries its own <c>Index</c> + <c>Name</c> + <c>State</c>.
        /// A retype of a wire-visible member on a <c>[TsInterface]</c> type is
        /// breaking by definition. Why: a positional array can carry STATE but
        /// never a NAME, and names are what both vanilla (which shipped
        /// anonymous customs the client had to hardcode as "AG1".."AG10") and
        /// Action Groups Extended (up to 250 player-named groups) need. The
        /// list is also no longer fixed-length; see
        /// <see cref="ActionGroupState"/>.</para>
        ///
        /// <para>(2) <see cref="CommsDelay.OneWaySeconds"/>
        /// retyped <c>double</c> -&gt; <c>double?</c> (comms-delay-nullable-when-no-path
        /// fix). The old <c>0</c> sentinel for "no measurable path" read as
        /// "instant" to a naive reader (the opposite of a lost link) and
        /// violated this contract's own R7 discipline (absence is a nullable,
        /// never a 0/-1 sentinel). Now <c>null</c> means no measurable
        /// <see cref="CommsPath"/>; <c>0</c> is reserved for the OTHER "None"
        /// case (delay feature disabled but connected: a genuine zero
        /// applied); a real number means <see cref="CommsDelaySource.SignalDelay"/>.
        /// See
        /// <c>local_docs/Wednesday Work/2026-07-16-comms-delay-nullable-when-no-path.md</c>.</para>
        /// </summary>
        /// <remarks>
        /// <para><b>Bumped 4 -&gt; 5 (Minor reset to 0): the thermal channel
        /// carries kelvin only.</b> Removed
        /// <c>VesselThermal.HeatShieldTempCelsius</c>, replaced by
        /// <see cref="VesselThermal.HeatShieldTemp"/> in K. A removed member on
        /// a wire-visible type is breaking by definition, which is why this is a
        /// Major and not a rename dressed as a Minor.</para>
        ///
        /// <para>Why it was worth one: that field was the ONLY temperature on
        /// <c>vessel.thermal</c> not in kelvin, and the inconsistency was not
        /// cosmetic, it was actively causing a wrong readout. ThermalStatus read
        /// <c>hottestPart.skinTemp</c> (declared K, and genuinely K) as though it
        /// were Celsius, displayed it about 273 degrees high, and guarded it with
        /// a Celsius sentinel that could never fire on a kelvin value, so a
        /// vessel with no thermometer showed "2.0 degC" instead of dropping the
        /// row. Both the unit tests and the Playwright stream fixture had been
        /// updated to match that output rather than the physics. One unit per
        /// channel removes the choice that was being got wrong, and Celsius
        /// becomes what it always should have been: a presentation unit the
        /// client asks for by name. <c>Units.Celsius</c> is deleted from the
        /// vocabulary for the same reason, so the mistake cannot be respelled.</para>
        ///
        /// <para>Sanctioned on the same standing grounds as the Major 2 -&gt; 3
        /// revert and the Major 3 -&gt; 4 collapse: the mod is still pre-release
        /// with NO external Uplinks, and the app and mod ship together, so no
        /// artifact exists that was built against the old shape.</para>
        ///
        /// <para><b>Bumped 5 -&gt; 6 (Minor reset to 0): the dead
        /// <c>Meta.Confidence</c> field leaves the wire.</b> Removed the
        /// optional <c>Meta.Confidence</c> (<c>double?</c>). A removed member on
        /// a wire-visible type is breaking by definition, which is why this is a
        /// Major and not a quiet Minor.</para>
        ///
        /// <para>Why it was worth one: the field had no producer. The mod
        /// declared it and the serializer wrote it only when
        /// <c>meta.Confidence.HasValue</c>, but nothing ever SET it on an
        /// outgoing frame (the only <c>Confidence =</c> in the mod was the
        /// deserializer, reading an incoming frame), so it was always null on
        /// the wire and always omitted from the JSON. It was a slot every
        /// consumer had to account for and none could ever read. Removing it is
        /// the honest state. Jon approved the removal (2026-08-02). Sanctioned
        /// on the same standing grounds as every Major above: the mod is still
        /// pre-release with NO external Uplinks, and the app and mod ship
        /// together, so no artifact exists that was built against the old shape.
        /// See
        /// <c>local_docs/design/specs/2026-08-02-units-game-RESOLVED-local-files.md</c>.</para>
        /// </remarks>
        public const int Major = 6;

        /// <summary>
        /// Reset to 0 alongside the Major 3 -&gt; 4 bump (see <see cref="Major"/>),
        /// then bumped 0 -&gt; 1 on the Major-4 line for the kerbcast Uplink's
        /// control-plane types (see the Major-4 entry below).
        /// The remaining Minor history below belongs to the Major-1/2/3 lines
        /// and is retained for provenance; every one of those additive
        /// changes is carried forward into Major 4.
        ///
        /// <para>Major-3 history, Bumped 2 -&gt; 3 (Minor reset to 0): the
        /// Principia mod-seam revert. Removed
        /// <see cref="VesselPhysicsMode.IsPrincipiaActive"/> from the
        /// wire-visible <see cref="VesselPhysicsMode"/> Value: core detecting
        /// a specific third-party mod (Principia) was a mod-seam violation;
        /// that awareness belongs to a future Principia Uplink instead. The
        /// <c>Mode</c> field (OnRails/Packed/Unpacked, genuine stock KSP data)
        /// is unaffected.</para>
        ///
        /// <para>Major-3 history, Bumped 2 -&gt; 3: additive-only Minor for the
        /// flight-lifecycle domain (<see cref="FlightCurrent"/>/
        /// <see cref="FlightStarted"/>/<see cref="FlightEnded"/>/
        /// <see cref="FlightVesselChanged"/>/<see cref="FlightEndReason"/>):
        /// retires the client-side <c>FlightDetector</c> heuristic. All
        /// brand-new types: additive, so it cannot break an Uplink built
        /// against an older Minor. See
        /// <c>docs/superpowers/plans/2026-07-11-flight-lifecycle-spec.md</c>.</para>
        ///
        /// <para>Bumped 1 -&gt; 2: additive-only Minor for the
        /// <c>scansat.anomalies.&lt;body&gt;</c> dynamic-namespace element type
        /// (<see cref="ScanAnomalyEntry"/>: the scansat.anomalies P4c-b
        /// sign-off item, closing <c>ScansatUplink.cs</c>'s known gap 3). A
        /// brand-new type only: additive, so it cannot break an Uplink built
        /// against an older Minor. See
        /// <c>docs/superpowers/plans/2026-07-11-p4cb-deletion-plan.md</c> §1/§4.</para>
        ///
        /// <para>Bumped 0 -&gt; 1: additive-only Minor for the
        /// <c>recovery.*</c> wire contract (the P4c-b pre-deletion BUILD,
        /// <see cref="RecoveryReport"/>/<see cref="RecoveryScienceEntry"/>/
        /// <see cref="RecoveryPartEntry"/>/<see cref="RecoveryResourceEntry"/>/
        /// <see cref="RecoveryCrewEntry"/>). All brand-new types: additive, so
        /// it cannot break an Uplink built against an older Minor. See
        /// <c>docs/superpowers/plans/2026-07-11-p4cb-deletion-plan.md</c> §2.</para>
        ///
        /// <para>Major-1 history, Bumped 0 -&gt; 1: additive-only Minor for dynamic-namespace channel
        /// registration (<see cref="IUplinkHost.RegisterDynamicNamespace"/>/
        /// <see cref="IDynamicChannelSource"/>) plus per-channel
        /// <see cref="ChannelDeclaration.Delay"/> disposition. Neither
        /// touches an existing <see cref="ISitrepUplink"/>'s compile-time
        /// surface: see <c>.superpowers/sdd/contract-dynamic-delay-report.md</c>.</para>
        ///
        /// <para>Bumped 1 -&gt; 2: additive-only Minor for the
        /// capture-on-main / handle-on-Courier seam
        /// (<see cref="IUplinkHost.AddSampledSource"/>): a new method on
        /// <see cref="IUplinkHost"/> (which an Uplink CONSUMES, never
        /// implements), so it cannot break any existing
        /// <see cref="ISitrepUplink"/> built against an older Minor. See
        /// <c>.superpowers/sdd/f1-main-thread-sampler-report.md</c>.</para>
        ///
        /// <para>Bumped 2 -&gt; 3: additive-only Minor for the
        /// subscription-gated <see cref="IUplinkHost.AddSampledSource(System.Func{KspSnapshot?, object?}, System.Action{object?}, string[])"/>
        /// overload: a new method on <see cref="IUplinkHost"/> (which an Uplink
        /// CONSUMES, never implements), so it cannot break any existing
        /// <see cref="ISitrepUplink"/> built against an older Minor. See
        /// <c>.superpowers/sdd/f1-hardening-report.md</c>.</para>
        ///
        /// <para>Major-2 history, Bumped 0 -&gt; 1: additive-only Minor adding the
        /// <see cref="CommandErrorCode.Timeout"/> member (the F2-fix pause/
        /// scene-load backstop failure code). A new enum member cannot break an
        /// Uplink built against an older Minor: see
        /// <c>.superpowers/sdd/f2-fix-brief.md</c>.</para>
        ///
        /// <para>Bumped 1 -&gt; 2: additive-only Minor adding the comms.* wire
        /// contract (U2: comms trio): the <see cref="CommsConnectivity"/>/
        /// <see cref="CommsSignalStrength"/>/<see cref="CommsControlState"/>/
        /// <see cref="CommsPath"/>/<see cref="CommsHop"/>/<see cref="CommsNetwork"/>
        /// (+ node/edge)/<see cref="CommsDelay"/>/<see cref="CommsLinkQuality"/>/
        /// <see cref="CommsDataRate"/>/<see cref="CommsLinkMargin"/> payloads and
        /// their enums (<see cref="CommsControlSource"/>/
        /// <see cref="CommsControlStateKind"/>/<see cref="CommsHopKind"/>/
        /// <see cref="CommsDelaySource"/>). All brand-new types: additive, so it
        /// cannot break an Uplink built against an older Minor. The
        /// <see cref="ICommsBackend"/> capability seam is NOT a wire type (no
        /// <see cref="SitrepContractAttribute"/>): it is the pure Kernel-elected
        /// object, so it never appears in the shape baseline. See
        /// <c>local_docs/telemetry-mod/comms-uplink-design.md</c>.</para>
        ///
        /// <para>Bumped 1 -&gt; 2: additive-only Minor for the kOS Uplink P1
        /// compute/processor wire types (<see cref="KosProcessorInfo"/>,
        /// <see cref="KosComputeStatus"/>, <see cref="KosExecArgs"/>,
        /// <see cref="KosReEnableArgs"/>): brand-new <c>[SitrepContract]</c>
        /// types only, no existing type touched, so it cannot break any Uplink
        /// built against an older Minor. See <c>kos-migration-spec.md</c> §4-5
        /// and <c>.superpowers/sdd/u3-kos-report.md</c>.</para>
        ///
        /// <para>Bumped 3 -&gt; 4: additive-only Minor for the kOS interactive
        /// terminal-over-Uplink wire types (<see cref="KosTerminalFrame"/>,
        /// <see cref="KosTerminalOpenArgs"/>, <see cref="KosKeystrokeArgs"/>,
        /// <see cref="KosTerminalResizeArgs"/>, <see cref="KosTerminalCloseArgs"/>),
        /// the <c>kos.terminal.&lt;coreId&gt;</c> ReliableOrdered screen
        /// downlink + its single-owner keystroke/resize/open/close commands,
        /// replacing the standalone telnet proxy. Brand-new
        /// <c>[SitrepContract]</c> types only, no existing type touched.</para>
        ///
        /// <para>Bumped 4 -&gt; 5: additive-only Minor for the comms connectivity
        /// MetaTopic (<see cref="CommsLink"/>): the Delayed, freeze-exempt
        /// <c>comms.link</c> channel that carries the client-facing link
        /// up/down, letting the disconnect edge escape the reveal-gate freeze
        /// while the de-publicised TrueNow observation channels leave the wire.
        /// A brand-new <c>[SitrepContract]</c> type only, no existing type
        /// touched: additive, so it cannot break an Uplink built against an
        /// older Minor. See
        /// <c>local_docs/Wednesday Work/2026-07-15-comms-delay-model-consistency.md</c>.</para>
        ///
        /// <para>Major-4 line, Bumped 0 -&gt; 1: additive-only Minor for the
        /// kerbcast Uplink's CONTROL-plane wire types
        /// (<see cref="KerbcastCameraEntry"/>, <see cref="KerbcastSetFieldOfViewArgs"/>,
        /// <see cref="KerbcastSetPanArgs"/>): the <c>kerbcast.cameras</c>
        /// camera/capability/docking-port inventory plus its
        /// <c>kerbcast.setFieldOfView</c>/<c>kerbcast.setPan</c> commands.
        /// kerbcast's VIDEO deliberately stays on WebRTC; only the control
        /// plane becomes an Uplink. Brand-new <c>[SitrepContract]</c> types
        /// only, no existing type touched: additive, so it cannot break an
        /// Uplink built against an older Minor. See
        /// <c>mod/GonogoKerbcastUplink/</c>.</para>
        ///
        /// <para>Major-4 line, Bumped 1 -&gt; 2: additive-only Minor for the
        /// mod-hash binding: the new nullable <see cref="UplinkManifest.ExpectedClientHash"/>,
        /// emitted on the engine-built <c>system.uplinks</c> roster
        /// (<c>expectedClientHash: string | null</c>). Carries H_mod so the app can enforce
        /// the three-way client-integrity agreement (design
        /// docs/superpowers/specs/2026-07-17-uplink-hub-and-loader-design.md §3). A new
        /// nullable field on a hand-declared engine channel + a non-reflected manifest type,
        /// additive, so it cannot break an Uplink built against an older Minor.</para>
        ///
        /// <para>Major-4 line, Bumped 2 -&gt; 3: additive-only Minor for the
        /// MapView overlay-host POI foundation's one wire change (T-POI-3):
        /// the new <c>spaceCenter.pois</c> channel (<see cref="SpaceCenterPoiEntry"/>,
        /// the map points-of-interest union of launch sites and active/offered
        /// contract targets), the new <see cref="TargetKind.Position"/> enum
        /// member (appended, never inserted), and the new nullable
        /// <see cref="SetTargetArgs.Latitude"/>/<see cref="SetTargetArgs.Longitude"/>
        /// fields on the existing <see cref="SetTargetArgs"/> type. A brand-new
        /// Topic, a brand-new enum member and two brand-new nullable fields,
        /// nothing removed or retyped, so it cannot break an Uplink built
        /// against an older Minor. See
        /// <c>docs/superpowers/plans/2026-07-18-mapview-overlay-host-foundation.md</c>
        /// §T-POI-3.</para>
        ///
        /// <para>Major-4 line, Bumped 3 -&gt; 4: additive-only Minor for the
        /// KerbalismUplink Domain and the reliability capability. New Topics
        /// <c>kerbalism.spaceweather</c>/<c>kerbalism.lifesupport</c>/<c>kerbalism.crew</c>/
        /// <c>kerbalism.features</c> (<see cref="KerbalismSpaceWeather"/>,
        /// <see cref="KerbalismLifeSupport"/>, <see cref="KerbalismCrewEntry"/>,
        /// <see cref="KerbalismFeatures"/> + nested value shapes) and the
        /// Domain-neutral <c>reliability.summary</c>/<c>reliability.parts</c>
        /// (<see cref="ReliabilitySummary"/>, <see cref="ReliabilityPartEntry"/>,
        /// elected via the <c>reliability</c> Kernel capability, see Reliability.cs).
        /// All brand-new Topics + value shapes, nothing removed or retyped, so it
        /// cannot break an Uplink built against an older Minor. See
        /// <c>docs/superpowers/plans/2026-07-22-kerbalism-uplink.md</c>.</para>
        ///
        /// <para>Major-4 line, Bumped 4 -&gt; 5: additive-only Minor for the
        /// <c>avionics.status</c> Topic (<see cref="AvionicsStatus"/>): the RP-1
        /// controllable-mass ascent go/no-go emitted by <c>GonogoAvionicsUplink</c>.
        /// A brand-new <c>[SitrepContract]</c> type only, nothing removed or
        /// retyped, so it cannot break an Uplink built against an older Minor. See
        /// <c>docs/superpowers/plans/2026-07-22-avionics-uplink.md</c>.</para>
        ///
        /// <para>Major-4 line, Bumped 5 -&gt; 6: additive-only Minor adding
        /// <see cref="VesselPart.ActionBindings"/> (a new <c>List&lt;ActionBinding&gt;</c>
        /// field on the existing <see cref="VesselPart"/>) + the brand-new
        /// <see cref="ActionBinding"/> <c>[SitrepContract]</c> type: per-action
        /// action-group bindings in the parts tree, retiring the legacy
        /// <c>f.ag.bindings</c> shim read. A NEW field on an existing wire type +
        /// a new type is additive (never removes/renames/retypes a member), so it
        /// cannot break an Uplink built against an older Minor.</para>
        ///
        /// <para>Bumped 6 -&gt; 7: the Target API additions, <see cref="TargetKind.Part"/>
        /// (appended enum member), <see cref="VesselTarget.PartId"/> +
        /// <see cref="VesselTarget.ClosestApproach"/>, <see cref="SetTargetArgs.PartId"/>,
        /// and the new <c>target.available</c> channel (<see cref="TargetAvailable"/>/
        /// <see cref="TargetListEntry"/>) + <see cref="ClosestApproach"/>. All additive
        /// (new members / new types / an appended enum member), nothing removed or
        /// retyped, so it cannot break an Uplink built against an older Minor.
        /// Consolidated onto staging alongside the 5 -&gt; 6 action-bindings bump
        /// (both additive field sets coexist). See
        /// <c>docs/superpowers/plans/2026-07-23-target-api-plan.md</c>.</para>
        ///
        /// <para>Reset 7 -&gt; 0 alongside the Major 4 -&gt; 5 bump (the
        /// kelvin-only thermal channel; see <see cref="Major"/>). Every additive
        /// change on the Major-4 line above is carried forward into Major 5.</para>
        ///
        /// <para>Bumped 0 -&gt; 1: PROVENANCE ONLY, no wire member added,
        /// removed, or retyped. Four units findings applied:
        /// <see cref="PartsPayloads.ServoEntry.MaxTorque"/> retagged
        /// <see cref="Units.Kilonewtons"/> (was <c>kN·m</c>, now deleted from
        /// the vocabulary); <see cref="ExperimentEntry.TransmitBonus"/>
        /// retagged <see cref="Units.Ratio"/> (was
        /// <see cref="Units.Dimensionless"/>); <see cref="LabEntry.ScienceRate"/>
        /// retagged the new <see cref="Units.SciencePerDay"/> token (was
        /// <see cref="Units.NotApplicable"/>). All three are metadata-only
        /// retags of the <c>SitrepUnit</c> ATTRIBUTE, not the member's wire
        /// type, so none trips the contract-shape gate. See
        /// <c>local_docs/design/specs/2026-08-02-units-game-RESOLVED-local-files.md</c>.</para>
        ///
        /// <para>Reset 1 -&gt; 0 alongside the Major 5 -&gt; 6 bump (the
        /// <c>Meta.Confidence</c> removal; see <see cref="Major"/>). Every
        /// additive change on the Major-5 line above is carried forward into
        /// Major 6.</para>
        ///
        /// <para>Major-6 line, Bumped 0 -&gt; 1: additive-only Minor for the
        /// bidirectional control-channel mechanism, the new
        /// <see cref="SitrepControlChannelAttribute"/> plus its first annotation
        /// on <see cref="VesselControl.Throttle"/> (channel
        /// <c>vessel.control.throttle</c>, pairing the existing
        /// <c>vessel.control</c> read field with the existing
        /// <c>vessel.control.setThrottle</c> command). A new attribute type and a
        /// metadata annotation on an existing property, no wire member added,
        /// removed or retyped, so it cannot break an Uplink built against an older
        /// Minor. The write command and read field stay two separate wire keys;
        /// only the SDK unifies them. See
        /// <c>local_docs/design/plans/2026-08-02-bidirectional-control-channels-plan.md</c>.</para>
        ///
        /// <para>Same Minor-1 batch (Major 6 parked, additive changes accumulate):
        /// added the new nullable <see cref="VesselLanding.DragToWeightRatio"/>
        /// (aggregate drag force ÷ vessel weight; the numeric form of
        /// <c>DescentRegime</c>), surfacing the drag/weight balance the landing
        /// model already computes so the DescentEnvelope widget can draw a drag
        /// arrow. A NEW nullable field on an existing wire type (never
        /// removes/renames/retypes a member), so it cannot break an Uplink built
        /// against an older Minor.</para>
        ///
        /// <para>Same Minor batch (Major 6 parked): added the new nullable
        /// <see cref="KosProcessorInfo.PartName"/> (the CPU part's display title,
        /// e.g. "Probe Core"), so the kOS terminal's CPU picker can label an
        /// untagged CPU by its part name instead of a bare "CPU &lt;id&gt;". A
        /// NEW nullable field on an existing wire type, additive-only.</para>
        /// </summary>
        public const int Minor = 2;
    }
}
