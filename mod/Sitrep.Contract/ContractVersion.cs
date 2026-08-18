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
        ///
        /// <para><b>Bumped 6 -&gt; 7: the Avionics relocation.</b>
        /// <c>AvionicsStatus</c> LEFT this assembly entirely, relocated into
        /// the new <c>GonogoAvionicsUplink.Contract</c> project (the second
        /// step of the uplink-types-out-of-core plan, after the MechJeb
        /// pilot). Unlike MechJeb's two command-arg types, <c>AvionicsStatus</c>
        /// predates the v6.0 freeze (see the Major-4 line's "Bumped 4 -&gt; 5"
        /// Minor-history entry below): it IS part of the frozen v6.0 floor in
        /// <c>contract-shape.baseline.json</c>, so its removal registers as a
        /// genuine <c>type-removed:Sitrep.Contract.AvionicsStatus</c> break
        /// against that floor, not a vacuous one. That is a real difference
        /// from the MechJeb pilot's Minor-only bump, and exactly the case
        /// <c>ContractShapeGateTests.CurrentShapeIsAdditiveOverTheFrozenMajorFloor</c>
        /// exists to catch: a Major bump (with a freshly frozen Major-7 floor)
        /// is the only way to keep that gate green here. Sanctioned on the
        /// same standing grounds as every Major above: the mod is still
        /// pre-release with NO external Uplinks, and the app and mod ship
        /// together, so no artifact exists that was built against the old
        /// shape; the wire FORMAT of <c>avionics.status</c> is unchanged, only
        /// which assembly declares it. See
        /// <c>local_docs/design/2026-08-10-uplink-types-out-of-core-plan.md</c>.</para>
        ///
        /// <para><b>Bumped 7 -&gt; 8: the Kerbcast relocation.</b>
        /// <c>KerbcastCameraEntry</c>/<c>KerbcastSetFieldOfViewArgs</c>/
        /// <c>KerbcastSetPanArgs</c> LEFT this assembly entirely, relocated
        /// into the new <c>GonogoKerbcastUplink.Contract</c> project (the
        /// third step of the uplink-types-out-of-core plan, after the MechJeb
        /// pilot and the Avionics relocation). Same shape as the Avionics
        /// case, not the MechJeb one: these three types predate the v6.0
        /// freeze (added on the Major-4 line, see the "Major-4 line, Bumped 0
        /// -&gt; 1" Minor-history entry below), so all three ARE part of the
        /// frozen v7.0 floor in <c>contract-shape.baseline.json</c>, and their
        /// removal registers as three genuine <c>type-removed:</c> breaks
        /// against that floor, not vacuous ones. A Major bump (with a freshly
        /// frozen Major-8 floor) is the only way to keep
        /// <c>ContractShapeGateTests.CurrentShapeIsAdditiveOverTheFrozenMajorFloor</c>
        /// green here. Sanctioned on the same standing grounds as every Major
        /// above: the mod is still pre-release with NO external Uplinks, and
        /// the app and mod ship together, so no artifact exists that was
        /// built against the old shape; the wire FORMAT of
        /// <c>kerbcast.cameras</c>/<c>kerbcast.setFieldOfView</c>/
        /// <c>kerbcast.setPan</c> is unchanged, only which assembly declares
        /// them. See
        /// <c>local_docs/design/2026-08-10-uplink-types-out-of-core-plan.md</c>.</para>
        ///
        /// <para><b>Bumped 8 -&gt; 9: the SCANsat relocation.</b>
        /// <c>ScanningVesselEntry</c>/<c>ScanSensorEntry</c>/
        /// <c>ScanTrackColor</c>/<c>ScanScienceEntry</c>/<c>ScanAnomalyEntry</c>
        /// LEFT this assembly entirely, relocated into the new
        /// <c>GonogoScansatUplink.Contract</c> project (the fourth step of the
        /// uplink-types-out-of-core plan, after the MechJeb pilot and the
        /// Avionics and Kerbcast relocations, and the largest: five types, two
        /// <c>[SitrepTopic]</c> roots, and the first with NESTED payload types).
        /// Same shape as the Avionics and Kerbcast cases, not the MechJeb one:
        /// all five predate the v6.0 freeze (added on the Major-4 line, see the
        /// two Minor-history entries below that record
        /// <c>scansat.scanningVessels</c>/<c>scansat.science</c> and the
        /// <c>scansat.anomalies.&lt;body&gt;</c> element type), so all five ARE
        /// part of the frozen v8.0 floor in
        /// <c>contract-shape.baseline.json</c>, and their removal registers as
        /// five genuine <c>type-removed:</c> breaks against that floor, not
        /// vacuous ones. A Major bump (with a freshly frozen Major-9 floor) is
        /// the only way to keep
        /// <c>ContractShapeGateTests.CurrentShapeIsAdditiveOverTheFrozenMajorFloor</c>
        /// green here. Sanctioned on the same standing grounds as every Major
        /// above: the mod is still pre-release with NO external Uplinks, and
        /// the app and mod ship together, so no artifact exists that was
        /// built against the old shape; the wire FORMAT of
        /// <c>scansat.scanningVessels</c>/<c>scansat.science</c>/
        /// <c>scansat.anomalies.&lt;body&gt;</c> is unchanged, only which
        /// assembly declares them. See
        /// <c>local_docs/design/2026-08-10-uplink-types-out-of-core-plan.md</c>.</para>
        ///
        /// <para><b>Bumped 9 -&gt; 10: the Kerbalism relocation.</b> All fifteen
        /// <c>Kerbalism*</c> payload types LEFT this assembly entirely, relocated
        /// into the new <c>GonogoKerbalismUplink.Contract</c> project (the fifth
        /// step of the uplink-types-out-of-core plan, and the largest by every
        /// measure: fifteen types against the previous high of five, five
        /// <c>[SitrepTopic]</c> roots against two, and nesting three levels deep).
        /// Same shape as the Avionics, Kerbcast and SCANsat cases, not the MechJeb
        /// one: NINE of the fifteen predate the v6.0 freeze
        /// (<c>KerbalismSpaceWeather</c>, <c>KerbalismLifeSupport</c>,
        /// <c>KerbalismResource</c>, <c>KerbalismHabitat</c>,
        /// <c>KerbalismProcessEntry</c>, <c>KerbalismGreenhouseEntry</c>,
        /// <c>KerbalismCrewEntry</c>, <c>KerbalismCrewRule</c>,
        /// <c>KerbalismFeatures</c>: see the Minor-history entry below that
        /// records the KerbalismUplink Domain landing on the Major-4 line), so
        /// those nine ARE part of the frozen v9.0 floor in
        /// <c>contract-shape.baseline.json</c> and their removal registers as nine
        /// genuine <c>type-removed:</c> breaks against it. The other six
        /// (<c>KerbalismStarInfo</c>, <c>KerbalismStormEntry</c>,
        /// <c>KerbalismProfile</c>, <c>KerbalismResourceDef</c>,
        /// <c>KerbalismRuleDef</c>, <c>KerbalismProcessDef</c>) were added after
        /// the v9.0 floor was frozen, so they are not in it and their removal
        /// breaks nothing recorded. A Major bump (with a freshly frozen Major-10
        /// floor) is the only way to keep
        /// <c>ContractShapeGateTests.CurrentShapeIsAdditiveOverTheFrozenMajorFloor</c>
        /// green here. Sanctioned on the same standing grounds as every Major
        /// above: the mod is still pre-release with NO external Uplinks, and the
        /// app and mod ship together, so no artifact exists that was built against
        /// the old shape; the wire FORMAT of
        /// <c>kerbalism.spaceweather</c>/<c>kerbalism.profile</c>/
        /// <c>kerbalism.lifesupport</c>/<c>kerbalism.crew</c>/
        /// <c>kerbalism.features</c> is unchanged, only which assembly declares
        /// them.</para>
        ///
        /// <para><b>One consequence worth naming, so it is not mistaken for a
        /// fix.</b> The Major-9 floor recorded <c>KerbalismLifeSupport</c> with
        /// four per-resource properties (<c>ElectricCharge</c>/<c>Food</c>/
        /// <c>Oxygen</c>/<c>Water</c>, each a <c>KerbalismResource</c>) that the
        /// live shape had already dropped in favour of the <c>Rates</c> map, and
        /// the shape gate had been reporting exactly those four as a standing red
        /// on this branch. Freezing Major 10 as the Major-9 floor MINUS the nine
        /// relocated types (never as the live shape, which would have absorbed
        /// unrelated drift wholesale) removes that type from the floor along with
        /// its four members, so the red clears. It clears because the type left
        /// core, not because the drift was forgiven: every OTHER frozen member on
        /// the Major-9 floor is carried into Major 10 untouched, so any drift
        /// elsewhere is still caught. The four-member break is recorded for good
        /// in the Major-9 entry of the ledger.</para>
        ///
        /// <para><b>Bumped 10 -&gt; 11: the kOS relocation, which completes the
        /// plan's per-Uplink list.</b> All ELEVEN <c>Kos*</c> types LEFT this
        /// assembly entirely, relocated into the new
        /// <c>GonogoKosUplink.Contract</c> project (the sixth and last step of the
        /// uplink-types-out-of-core plan): the one <c>[SitrepTopic]</c> root
        /// <c>KosProcessorInfo</c>, the three dynamic-channel payloads
        /// <c>KosTerminalFrame</c>/<c>KosRunResult</c>/<c>KosComputeStatus</c>, and
        /// the seven command args <c>KosExecArgs</c>/<c>KosReEnableArgs</c>/
        /// <c>KosRunArgs</c>/<c>KosTerminalOpenArgs</c>/<c>KosKeystrokeArgs</c>/
        /// <c>KosTerminalResizeArgs</c>/<c>KosTerminalCloseArgs</c>. Unlike every
        /// earlier relocation, ALL ELEVEN sit in the outgoing floor, so this Major
        /// declares eleven <c>type-removed:</c> breaks with no
        /// added-after-the-freeze remainder: the four P1 compute/processor types
        /// and the five terminal types landed on the Major-4 line's Minors
        /// 1-&gt;2 and 3-&gt;4 (see the two Minor-history entries below), and
        /// <c>KosRunArgs</c>/<c>KosRunResult</c> followed on the same line, so the
        /// whole slice predates the v6.0 freeze and has been carried into every
        /// floor since. A Major bump (with a freshly frozen Major-11 floor) is the
        /// only way to keep
        /// <c>ContractShapeGateTests.CurrentShapeIsAdditiveOverTheFrozenMajorFloor</c>
        /// green here. Sanctioned on the same standing grounds as every Major
        /// above: the mod is still pre-release with NO external Uplinks, and the
        /// app and mod ship together, so no artifact exists that was built against
        /// the old shape; the wire FORMAT of <c>kos.processors</c>,
        /// <c>kos.terminal.&lt;coreId&gt;</c>, <c>kos.run.&lt;coreId&gt;</c>,
        /// <c>kos.compute.&lt;id&gt;.status</c> and the seven commands is
        /// unchanged, only which assembly declares them.</para>
        ///
        /// <para><b>What the Major-11 floor deliberately does NOT absorb.</b>
        /// Frozen as the Major-10 floor MINUS exactly those eleven types, never as
        /// the live reflected shape. The Major-10 floor recorded
        /// <c>KosProcessorInfo</c> with FIVE members; the live type has six
        /// (<c>PartName</c> was added later on the same Major-4 line, see the
        /// Minor-history entry below). Re-freezing from HEAD would have quietly
        /// taken in that difference along with any other drift standing in the
        /// contract. Subtracting the type instead removes its five frozen members
        /// as one declared <c>type-removed:</c> break and leaves every other frozen
        /// member carried forward untouched, so drift elsewhere is still
        /// caught.</para>
        ///
        /// <para><b>Bumped 11 -&gt; 12: the RealAntennas relocation, which
        /// COMPLETES the uplink-types-out-of-core migration.</b> Three types LEFT
        /// this assembly: <c>CommsLinkQuality</c>, <c>CommsDataRate</c> and
        /// <c>CommsLinkMargin</c>, relocated into the new
        /// <c>GonogoRealAntennasUplink.Contract</c> project. All three predate the
        /// v6.0 freeze and have been carried into every floor since, so all three
        /// are genuine <c>type-removed:</c> breaks against the Major-11 floor with
        /// no added-after-the-freeze remainder. Sanctioned on the same standing
        /// grounds as every Major above: the mod is still pre-release with NO
        /// external Uplinks, and the app and mod ship together, so no artifact
        /// exists that was built against the old shape.</para>
        ///
        /// <para><b>The one step of that plan that was a PARTIAL extract, and what
        /// stayed behind.</b> Every earlier relocation moved a whole file whose
        /// name already said which mod owned it. This one carved three types out of
        /// <c>Comms.cs</c>, which stays, because most of the comms family is a
        /// SHARED shape that whichever backend wins the <c>"comms"</c> capability
        /// election fills: connectivity, signalStrength, controlState, path,
        /// network, delay and link, their nested hop/graph types, and all four
        /// enums. Only the channels one Uplink declares in its OWN manifest and
        /// publishes itself moved. The case that fixes the boundary is
        /// <c>CommsHop.BandRateBitsPerSec</c>, which <c>Comms.cs</c> documents as a
        /// per-hop annotation present only under that mod: it STAYS, because it is
        /// a nullable field on a shared type rather than a type of its own, and
        /// splitting it would fork the one shape both backends fill.</para>
        ///
        /// <para><b>The wire format is unchanged; the writer is not.</b> Every
        /// earlier relocation was byte-for-byte inert because those payloads were
        /// already flattened by their producer. These three were the last in the
        /// mod still published as raw POCOs into a hand-written
        /// <c>JsonWriter</c> case, and a core serializer may not reference an
        /// Uplink assembly, so the flatten moved to the producer alongside the
        /// types. The JSON a subscriber receives is identical, key for key,
        /// including <c>meta</c> as <c>{ source, quality }</c> with quality as its
        /// integer ordinal.</para>
        ///
        /// <para><b>What the Major-12 floor deliberately does NOT absorb.</b>
        /// Frozen as the Major-11 floor MINUS exactly those three types, never as
        /// the live reflected shape, for the same reason every floor since Major 8
        /// has been: a re-freeze from HEAD takes in whatever unrelated drift
        /// happens to be standing in the contract at the time, and the whole point
        /// of the ledger is that a Major cannot rewrite what it inherited.</para>
        ///
        /// </remarks>
        public const int Major = 12;

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
        /// compute/processor wire types (<c>KosProcessorInfo</c>,
        /// <c>KosComputeStatus</c>, <c>KosExecArgs</c>,
        /// <c>KosReEnableArgs</c>): brand-new <c>[SitrepContract]</c>
        /// types only, no existing type touched, so it cannot break any Uplink
        /// built against an older Minor. See <c>kos-migration-spec.md</c> §4-5
        /// and <c>.superpowers/sdd/u3-kos-report.md</c>.</para>
        ///
        /// <para>Bumped 3 -&gt; 4: additive-only Minor for the kOS interactive
        /// terminal-over-Uplink wire types (<c>KosTerminalFrame</c>,
        /// <c>KosTerminalOpenArgs</c>, <c>KosKeystrokeArgs</c>,
        /// <c>KosTerminalResizeArgs</c>, <c>KosTerminalCloseArgs</c>),
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
        /// <para><b>Bumped 5 -&gt; 6:</b> the Breaking Ground uplink extraction's
        /// wire rename. <see cref="ServoEntry"/>'s Topic renamed
        /// <c>parts.robotics</c> -&gt; <c>robotics.servos</c>, and
        /// <see cref="DeployedEntry"/>'s Topic renamed <c>science.deployed</c> -&gt;
        /// <c>deployed.bases</c>: both
        /// moving under the uplink's own <c>robotics.*</c>/<c>deployed.*</c>
        /// prefixes as the robotics + deployed-science surfaces come out of the
        /// vanilla-comingled <c>PartsUplink</c>/<c>ScienceUplink</c> and into a
        /// single bundled, DLC-gated <c>GonogoBreakingGroundUplink</c>
        /// (<c>Expansions.ExpansionsLoader.IsExpansionInstalled("Serenity")</c>).
        /// A Topic rename changes the wire key a subscriber must ask for, so it
        /// is additive-but-renaming rather than a pure addition: existing readers
        /// of the old string keys stop receiving data, but no member is removed
        /// or retyped on the payload shapes themselves, and the mod + app ship
        /// together, so this is sanctioned as a Minor on the same standing
        /// grounds as the other pre-release renames in this file.</para>
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
        /// <c>KosProcessorInfo.PartName</c> (the CPU part's display title,
        /// e.g. "Probe Core"), so the kOS terminal's CPU picker can label an
        /// untagged CPU by its part name instead of a bare "CPU &lt;id&gt;". A
        /// NEW nullable field on an existing wire type, additive-only.</para>
        ///
        /// <para>Same Minor batch (Major 6 parked): added the new
        /// <see cref="FleetVesselLink"/> payload (display-only per-vessel
        /// <c>OneWaySeconds</c> + <c>Connected</c>) carried on
        /// <c>fleet.&lt;guid&gt;.delay</c>, so FleetRoster can show each vessel's
        /// signal delay + connectivity. A NEW wire type, additive-only, never
        /// touches an existing member.</para>
        ///
        /// <para><b>Bumped 3 -&gt; 4:</b> the <c>commandCentre.roster</c> channel
        /// and its <see cref="CommandCentreEntry"/> type (Plan 3): the roster of
        /// command centres (vantages/authorities) a dashboard can select. A NEW
        /// wire type, additive-only, never touches an existing member.</para>
        ///
        /// <para><b>Bumped 4 -&gt; 5 (delay-UX, additive):</b> an optional
        /// <c>Vantage</c> on <c>CommandRequest</c>, a per-call vantage override so
        /// a program-meta command can pin <c>"meta"</c> (instant) regardless of the
        /// connection's selected centre. Optional/backward-compatible: absent means
        /// the server uses the session vantage as before. Never touches an existing member.</para>
        ///
        /// <para><b>Bumped 5 -&gt; 6:</b> the <c>GonogoMechJebUplink</c> command arg
        /// DTOs, <c>MechJebAscentArgs</c> (its one field tagged with the new
        /// <see cref="Units.Kilometres"/> token) and <c>MechJebNoArgs</c> (the
        /// trivial no-payload marker for <c>mechjeb.executeNextNode</c>/
        /// <c>mechjeb.landAtTarget</c>). Both brand-new <c>[SitrepContract]</c> types,
        /// plus a brand-new unit token: additive-only, nothing removed or retyped, so
        /// it cannot break an Uplink built against an older Minor. See
        /// <c>local_docs/design/mechjeb-uplink-sketch.md</c> and
        /// <c>local_docs/design/mechjeb-decompile-lock.md</c>. (<c>MechJebAscentArgs</c>/
        /// <c>MechJebNoArgs</c> later left this assembly entirely: see the
        /// uplink-types-out-of-core provenance note below.)</para>
        ///
        /// <para><b>Bumped 6 -&gt; 7:</b> the Breaking Ground uplink split.
        /// The two Serenity-DLC wire topics move to their own prefix,
        /// <c>parts.robotics</c> -&gt; <c>robotics.servos</c> and
        /// <c>science.deployed</c> -&gt; <c>deployed.bases</c>, owned by the new
        /// DLC-gated <c>[SitrepUplink("breakingGround")]</c> and trimmed off
        /// <c>PartsUplink</c>/<c>ScienceUplink</c>. These are topic-key renames on
        /// the channel map, not member changes on any wire-visible
        /// <c>[TsInterface]</c> type, so no payload shape is removed, renamed or
        /// retyped and the contract-shape gate is unaffected. The DTO shapes carried
        /// on both channels are unchanged. See
        /// <c>mod/GonogoBreakingGroundUplink/</c>.</para>
        ///
        /// <para><b>Bumped 7 -&gt; 8:</b> the SpaceWeather reframe's solar-vantage
        /// capture + the ShipSystems modifier-ledger completion (option a'), one
        /// additive Minor for both batches. Solar vantage: the new
        /// <see cref="KerbalismSpaceWeather.Stars"/> (<see cref="KerbalismStarInfo"/>,
        /// one entry per star Kerbalism enumerates, star-agnostic) and
        /// <see cref="KerbalismSpaceWeather.Storms"/> (<see cref="KerbalismStormEntry"/>,
        /// one entry per (this vessel's current SOI body, star) CME slot, gated on
        /// the fair-vs-cheating <c>storm_state</c> boundary: <c>storm_generation</c>
        /// is never read) plus <see cref="KerbalismSpaceWeather.StormEjectionSpeed"/>.
        /// Modifier ledger: the new <see cref="KerbalismProcessEntry.EnvModifier"/>
        /// (live <c>Modifiers.Evaluate</c> product per process instance, capacity
        /// join token excluded) and <see cref="KerbalismLifeSupport.RuleEnvModifiers"/>
        /// (the same product per rule name, full modifier list). All brand-new
        /// members/types on existing or new <c>[SitrepContract]</c> shapes, nothing
        /// removed or retyped, so it cannot break an Uplink built against an older
        /// Minor. See
        /// <c>local_docs/design/2026-08-10-kerbalism-solar-vantage-and-modifiers.md</c>
        /// and
        /// <c>local_docs/design/2026-08-10-kerbalism-modifier-product-feasibility.md</c>.</para>
        ///
        /// <para><b>Bumped 8 -&gt; 9: the uplink-types-out-of-core pilot.</b>
        /// <c>MechJebAscentArgs</c>/<c>MechJebNoArgs</c> LEFT this assembly
        /// entirely, relocated into the new <c>GonogoMechJebUplink.Contract</c>
        /// project (their owning Uplink's own contract slice). Deliberately NOT a
        /// Major bump: <see cref="Major"/>'s own frozen ledger floor
        /// (<c>contract-shape.baseline.json</c>, frozen at v6.0) never included
        /// these two types in the first place, they were added afterward as an
        /// additive Minor (see the v5-&gt;6 entry above), so removing them now
        /// restores exactly the shape that WAS frozen: the ledger's own
        /// <c>ComputeRemovals</c> against that floor is empty, and
        /// <c>ContractShapeGateTests.EveryMajorBumpDeclaresExactlyWhatItBroke</c>
        /// refuses a Major that breaks nothing, on purpose, precisely to stop a
        /// vacuous bump like this one. A relocation to a DIFFERENT assembly is
        /// still an ABI change for anyone who compiled against Sitrep.Contract.dll
        /// today (mid Major-6 line), which is why this gets its own Minor rather
        /// than passing silently: this Minor's provenance note is that record. See
        /// <c>local_docs/design/2026-08-10-uplink-types-out-of-core-plan.md</c>.</para>
        ///
        /// <para>Reset 9 -&gt; 0 alongside the Major 6 -&gt; 7 bump (the
        /// Avionics relocation; see <see cref="Major"/>). Every additive
        /// change on the Major-6 line above is carried forward into Major 7.</para>
        ///
        /// <para>Reset 0 alongside the Major 7 -&gt; 8 bump (the Kerbcast
        /// relocation; see <see cref="Major"/>). Every additive change on the
        /// Major-7 line above is carried forward into Major 8.</para>
        ///
        /// <para>Reset 0 alongside the Major 8 -&gt; 9 bump (the SCANsat
        /// relocation; see <see cref="Major"/>). Every additive change on the
        /// Major-8 line above is carried forward into Major 9.</para>
        ///
        /// <para>Reset 0 alongside the Major 9 -&gt; 10 bump (the Kerbalism
        /// relocation; see <see cref="Major"/>). Every additive change on the
        /// Major-9 line above is carried forward into Major 10.</para>
        ///
        /// <para><b>Major-12 line, Bumped 0 -&gt; 1: the provider extension
        /// bag.</b> <see cref="ReliabilitySummary"/> and
        /// <see cref="ReliabilityPartEntry"/> each gain one nullable
        /// <c>Extensions</c> member, the permanent provider-namespaced hole that
        /// lets a reliability backend carry a field this assembly does not declare
        /// without a PR against it (see
        /// <c>Sitrep.Contract/ProviderExtensions.cs</c>). Additive and nullable: two
        /// new members on two existing shapes, nothing removed or retyped, so it
        /// cannot break an Uplink built against Major 12.0, and the frozen Major-12
        /// floor is NOT re-frozen. The wire is additive too, and provably so: the
        /// key is omitted entirely when no provider filled a bag, so an unextended
        /// payload is byte-for-byte what it was
        /// (<c>ReliabilityExtensionWireTests</c> pins that, alongside the end-to-end
        /// proof that an extension's <c>Value&lt;&gt;</c> still decodes wrapped).
        /// The two new <c>Reliability*</c> members are the LAST hand-listed
        /// provider-facing additions those types should ever take:
        /// <c>Sitrep.Host.Tests.ReliabilityContractShapeTests</c> now pins their
        /// member set, so a new provider field lands in the bag instead. See
        /// <c>local_docs/design/2026-08-11-provider-extension-mechanism-build-spec.md</c>.</para>
        ///
        /// <para><b>Major-12 line, Bumped 1 -&gt; 2: science becomes an elected
        /// capability with a superset.</b> Four of the <c>science.*</c> payloads
        /// (<see cref="ExperimentEntry"/>, <see cref="InstrumentEntry"/>,
        /// <see cref="LabEntry"/>, <see cref="ExperimentBreakdownEntry"/>) gain the
        /// same nullable <c>Extensions</c> bag, and the three that carry
        /// value-model-dependent numbers gain a nullable <c>ValueModel</c>
        /// discriminator (see <see cref="ScienceValueModels"/>). Additive and
        /// nullable: seven new members across four existing shapes, nothing removed
        /// or retyped, so an Uplink built against Major 12.0/12.1 is unaffected and
        /// the frozen Major-12 floor is NOT re-frozen.</para>
        ///
        /// <para>The wire gains ONE key on the stock path,
        /// <c>valueModel: "stock"</c> on those three payloads: deliberately present
        /// rather than inferred from absence, so a consumer never has to read a
        /// missing tag as "probably stock" (which would silently mislabel a third
        /// provider that forgot to tag). The bag itself stays byte-invisible until a
        /// provider fills it, the same omit-when-empty rule reliability's bag
        /// already proved.</para>
        ///
        /// <para>No unit changed on any existing field, which is the one thing a
        /// "superset" invites. A provider whose data is not in the declared unit
        /// leaves the field NULL and carries its real figure in its own bag
        /// namespace: a field's <see cref="SitrepUnitAttribute"/> is compile-time
        /// baked and cannot vary by elected provider, so putting a megabyte figure
        /// in a mits-typed field would have been a silent lie rather than a
        /// superset. See
        /// <c>local_docs/design/2026-08-11-science-subsume-build-spec.md</c>.</para>
        ///
        /// <para><b>Major-12 line, Bumped 2 -&gt; 3: the isru.* capability.</b> Two
        /// new Kernel-elected channels (<c>isru.drills</c>, <c>isru.converters</c>)
        /// and three new types (<see cref="IsruDrillEntry"/>,
        /// <see cref="IsruConverterEntry"/>, <see cref="IsruResourceFlow"/>), both
        /// entry types carrying the provider extension bag from the outset rather
        /// than growing a hand-curated superset first. Purely additive: no existing
        /// type gains, loses or retypes a member, so an Uplink built against any
        /// earlier Major-12 minor is unaffected and the frozen Major-12 floor is NOT
        /// re-frozen. Every unit these types use already existed in
        /// <see cref="Units"/>, so no unit token was declared and no existing field
        /// changed dimension. See
        /// <c>local_docs/design/2026-08-10-isru-resource-ops-topic-api.md</c>.</para>
        ///
        /// <para><b>Major-12 line, Bumped 3 -&gt; 4: source-attributed currency
        /// events.</b> A new per-vessel dynamic namespace
        /// <c>currency.&lt;guid&gt;.&lt;currency&gt;</c> and its
        /// <see cref="ScienceCreditEvent"/> type: a discrete currency delta carrying
        /// the vessel that caused it, revealed at THAT vessel's own light-time (the
        /// topic routes to the per-vessel <c>fleet.&lt;guid&gt;</c> node) instead of
        /// instantly. Closes the inference gap where an operator could read a distant
        /// event off the instant career total before the confirming vessel telemetry
        /// was allowed to arrive. Purely additive: <c>career.status</c> and every one of
        /// its <c>economy</c> fields keep their existing shape and their
        /// <see cref="DelayRole.TrueNow"/> classification (they gate spend decisions and
        /// must stay ground-truth), so an Uplink built against any earlier Major-12
        /// minor is unaffected and the frozen Major-12 floor is NOT re-frozen. Every
        /// unit these types use already existed in <see cref="Units"/>. See
        /// <c>local_docs/design/2026-08-10-currency-delay-escape-hatch.md</c>.</para>
        ///
        /// <para><b>Major-12 line, Bumped 4 -&gt; 5: the reputation half of the
        /// source-attributed currency events.</b> A new
        /// <see cref="ReputationLossEvent"/> on <c>currency.&lt;guid&gt;.reputation</c>,
        /// the narrative record of a crew loss and the reputation it cost, revealed at the
        /// losing vessel's own light-time. It carries a DELTA and no absolute total, by
        /// design: the GATING field <c>career.status.economy.reputation</c> stays TrueNow
        /// and instant (a strategy's <c>RequiredReputation</c> and contract offer
        /// availability key off the game's real current reputation, so a stale-high
        /// delayed number in front of an activate/accept control would fail against ground
        /// truth the operator could not see coming), and a delta-only type cannot be
        /// substituted for it. Purely additive, nothing removed or retyped, so the frozen
        /// Major-12 floor is NOT re-frozen. Every unit already existed in
        /// <see cref="Units"/>. See
        /// <c>local_docs/design/2026-08-10-currency-delay-escape-hatch.md</c> §3.</para>
        ///
        /// <para><b>Major-12 line, Bumped 5 -&gt; 6 and 6 -&gt; 7: a per-Topic
        /// <c>vesselId</c>, since WITHDRAWN.</b> Both minors were spent adding a
        /// <c>VesselId</c> to the fixed-name vessel-scoped payloads
        /// (<c>KerbalismLifeSupport</c>/<c>KerbalismCrewEntry</c> on 6; the
        /// <c>science.*</c>, <c>isru.*</c>, <c>reliability.*</c> and
        /// <c>deployed.bases</c> entry types on 7), so that a
        /// <see cref="DelayRole.Delayed"/> sample delivered light-time late could
        /// not be mistaken for the current vessel's after a switch. The gap is
        /// real; a field repeated on every entry of every capability payload is
        /// the wrong shape for it, and the boundary belongs at the ledger rather
        /// than on each sample. Every one of those fields is removed here.</para>
        ///
        /// <para>Both minors were added and withdrawn inside this same unreleased
        /// window: no consumer ever saw either shape, no floor recorded them (the
        /// frozen Major-12 baseline names none of these members), and nothing that
        /// existed before Minor 5 gains, loses or retypes anything. The minor
        /// stays at 7 rather than winding back, so a number never names two
        /// different shapes. <c>Units.Id</c> was already in use elsewhere and is
        /// untouched, as are the source-attributed currency events
        /// (<c>currency.&lt;guid&gt;.*</c>), which carry a vessel on the EVENT and
        /// are a different mechanism entirely.</para>
        ///
        /// <para>Bumped 7 -&gt; 8: PAW part actions. Adds
        /// <see cref="PartActionEntry"/>/<see cref="PartActions"/> (the payload of
        /// the new dynamic <c>vessel.partActions.&lt;flightId&gt;</c> namespace, a
        /// part's right-click Part Action Window buttons) and
        /// <see cref="InvokePartActionArgs"/> (the args of the new delayed
        /// <c>vessel.invokePartAction</c> command that fires one). Purely additive,
        /// two new types plus a new channel namespace and a new command, no
        /// existing member gains, loses or retypes anything, so an Uplink built
        /// against any earlier Major-12 minor is unaffected and the frozen Major-12
        /// floor is NOT re-frozen. <c>PartActions</c> carries NO per-Topic
        /// <c>vesselId</c>: the dynamic namespace is keyed by the part's flight id
        /// and the subject boundary belongs at the ledger, the same conclusion the
        /// withdrawal above records.</para>
        ///
        /// <para>Bumped 8 -&gt; 9: Astronaut Complex hiring. Added
        /// <see cref="AstronautComplexInfo"/> and (Major-12-only, retired at Minor
        /// 10 below) the payload type <c>ApplicantEntry</c> - the payload of the
        /// new <c>spaceCenter.astronautComplex</c> channel, the hireable applicant
        /// pool plus the roster cap + active-crew count - and
        /// <see cref="HireApplicantArgs"/> (the args of the new
        /// <c>career.crew.hire</c> command that recruits one, spending funds).
        /// Purely additive: two new payload types, one new command-arg type, a new
        /// channel and a new command, no existing member gains, loses or retypes
        /// anything, so an Uplink built against any earlier Major-12 minor is
        /// unaffected and the frozen Major-12 floor is NOT re-frozen. The applicant
        /// pool rides <c>DelayRole.TrueNow</c> (the Astronaut Complex is at KSC),
        /// same class as <c>spaceCenter.crewRoster</c>. See
        /// <c>local_docs/design/2026-08-12-astronaut-hiring-build-spec.md</c>.</para>
        ///
        /// <para><b>Bumped 9 -&gt; 10: the Astronaut Complex redesign's full crew
        /// surface.</b> <see cref="CrewRosterEntry"/> is broadened to the full
        /// <c>ProtoCrewMember</c> stat set (<see cref="CrewRosterEntry.Courage"/>/
        /// <see cref="CrewRosterEntry.Stupidity"/>/<see cref="CrewRosterEntry.Experience"/>/
        /// <see cref="CrewRosterEntry.ExperienceLevelDelta"/>/
        /// <see cref="CrewRosterEntry.Situation"/>/<see cref="CrewRosterEntry.RoleDescription"/>/
        /// <see cref="CrewRosterEntry.DescriptionEffects"/>) and then REUSED for
        /// <see cref="AstronautComplexInfo.Applicants"/> in place of
        /// <c>ApplicantEntry</c>, so a kerbal has ONE wire shape whether hired or
        /// still a candidate; hire cost moves off the per-applicant
        /// <c>ApplicantEntry.HireCost</c> onto the single
        /// <see cref="AstronautComplexInfo.NextHireCost"/> on the header (the price
        /// is the same for every applicant this tick, so it never belonged
        /// per-row). <c>ApplicantEntry</c> is removed entirely.</para>
        ///
        /// <para>Deliberately NOT a Major bump, the same shape as the Major-12
        /// line's "Bumped 8 -&gt; 9" pilot above: <see cref="Major"/>'s own frozen
        /// ledger floor (<c>contract-shape.baseline.json</c>, frozen at v12.0)
        /// never included <c>ApplicantEntry</c>, <c>AstronautComplexInfo</c>, or
        /// <c>ApplicantEntry.HireCost</c> in the first place - all three were added
        /// afterward as the additive Minor 8-&gt;9 above - so removing/retyping them
        /// now restores exactly the shape that WAS frozen: the ledger's own
        /// <c>ComputeRemovals</c> against that floor is empty, and
        /// <c>ContractShapeGateTests.EveryMajorBumpDeclaresExactlyWhatItBroke</c>
        /// refuses a Major that breaks nothing, on purpose, precisely to stop a
        /// vacuous bump like this one. Every field <see cref="CrewRosterEntry"/>
        /// gains is additive on a type that IS in the frozen floor, so those stay
        /// additive regardless. See
        /// <c>local_docs/design/2026-08-13-astronaut-complex-redesign-spec.md</c>
        /// and <c>local_docs/design/2026-08-13-astronaut-data-fetchability-audit.md</c>.</para>
        ///
        /// <para><b>Major-12 line, Bumped 10 -&gt; 11: the officially-lost
        /// determination.</b> A new <see cref="FleetVesselContact"/> type
        /// carried on <c>fleet.&lt;guid&gt;.contact</c> (same dynamic
        /// namespace as <see cref="FleetVesselLink"/>'s <c>.delay</c>):
        /// whether a vessel is currently in contact and, when it isn't, how
        /// long its silence has run and when it becomes eligible to be
        /// declared lost. Purely additive: a brand-new type on a brand-new
        /// dynamic-namespace suffix, nothing removed or retyped, so an
        /// Uplink built against any earlier Major-12 minor is unaffected and
        /// the frozen Major-12 floor is NOT re-frozen. Every unit this type
        /// uses already existed in <see cref="Units"/>. See
        /// <c>local_docs/design/2026-08-15-vessel-officially-lost.md</c>.</para>
        ///
        /// <para><b>Major-12 line, Bumped 11 -&gt; 12: which END of a comms hop is
        /// the ground station.</b> <see cref="CommsHop"/> gains
        /// <see cref="CommsHop.FromIsHome"/>/<see cref="CommsHop.ToIsHome"/>.
        /// Both backends also stop collapsing every ground station to the single
        /// literal name "home" and emit the station's own name instead, which is
        /// a VALUE change, not a shape change, so it costs no version at all.
        /// Purely additive on a type already in the frozen Major-12 floor:
        /// nothing is removed or retyped, so an Uplink built against any earlier
        /// Major-12 minor is unaffected. Together they make a direct
        /// vessel-to-KSC link distinguishable from a relay-mediated one, and a
        /// station-to-station handoff distinguishable from a single station at a
        /// changed range, off <c>comms.path</c> alone.</para>
        ///
        /// <para><b>Major-12 line, Bumped 12 -&gt; 13: comms/fleet contact
        /// ownership split.</b> <see cref="FleetVesselContact"/> loses
        /// <c>State</c>/<c>SilenceSinceUt</c>/<c>DeadlineUt</c>/<c>DeadlineBasis</c>/
        /// <c>PredictedReacquisitionUt</c>, narrowing to <c>Connected</c>/
        /// <c>LastContactUt</c>: ordinary KSP network-presence fact, unconditional
        /// whether or not any comms backend is elected. Those five removed fields
        /// are the SilenceTracker's officially-lost reckoning, a comms-derived
        /// model's opinion rather than a fact stock KSP hands you; they move to a
        /// brand-new <see cref="FleetVesselSilence"/> type on a brand-new
        /// <c>silence.&lt;guid&gt;.state</c> dynamic-namespace topic, registered
        /// from the comms uplink instead of the always-on core fleet
        /// namespace.</para>
        ///
        /// <para>Deliberately NOT a Major bump, the same shape as the Major-12
        /// line's "Bumped 8 -&gt; 9" pilot above: <see cref="Major"/>'s own frozen
        /// ledger floor never included <see cref="FleetVesselContact"/> at all
        /// (it was added afterward, purely additively, as the Minor 10-&gt;11
        /// bump above), so narrowing it now removes nothing the floor ever
        /// promised: the ledger's own <c>ComputeRemovals</c> against that floor
        /// is empty, and <c>ContractShapeGateTests.EveryMajorBumpDeclaresExactlyWhatItBroke</c>
        /// refuses a Major that breaks nothing, on purpose. See
        /// <c>local_docs/design/2026-08-15-vessel-officially-lost.md</c>.</para>
        ///
        /// <para><b>Major-12 line, Bumped 13 -&gt; 14: a patch can be propagated
        /// from what it carries.</b> <see cref="OrbitPatch"/> gains <c>Mu</c>,
        /// <c>ReferenceBodyIndex</c> and <c>ClosestEncounterBodyIndex</c>, all
        /// nullable, all additive, nothing removed or narrowed.
        ///
        /// <para>It was the only orbit on the wire that could not be propagated
        /// from its own fields: <see cref="VesselOrbit"/> carries <c>Mu</c> for
        /// exactly this reason ("self-sufficient propagation, no separate body
        /// lookup required") and a patch carried none of it, so a consumer had
        /// to resolve <see cref="OrbitPatch.ReferenceBody"/> through
        /// <c>system.bodies</c> to find the number. Measured against
        /// <c>local_docs/deck-fixtures/maneuver/2026-08-18-same-burn-two-starting-orbits.json</c>,
        /// where the same burn applied to two starting orbits is the validation
        /// case for any propagator: one arm's starting orbit is a patch and the
        /// other's is a vessel orbit, so the pair measured the lookup as well as
        /// the arithmetic.</para>
        ///
        /// <para>The index joins the convention every other body reference in
        /// this contract already uses, and is carried ALONGSIDE the name rather
        /// than replacing it: the name is load-bearing in
        /// <c>orbit-patches.ts</c>'s SOI-change detection and in
        /// <c>trajectory.ts</c>, which predates this Topic, so dropping it is a
        /// client migration and not a contract edit. Nullable rather than
        /// defaulted because 0 is a real body index, so a defaulted value would
        /// read as a confident wrong answer rather than an absent one.</para>
        /// </para>
        ///
        /// <para><b>Major-12 line, Bumped 14 -&gt; 15: a maneuver node becomes a
        /// BURN.</b> <see cref="ManeuverNode"/> gains <c>IgnitionUt</c>,
        /// <c>CutoffUt</c> and <c>Frame</c>, all nullable, all additive.
        ///
        /// <para>A stock node is an instantaneous impulse and real burns are
        /// not. Stock KSP concedes this itself by computing
        /// <c>DeltaVStageInfo.stageBurnTime</c> and carrying a burn-time
        /// readout on its own navball, and every serious maneuver mod in the
        /// ecosystem then reimplements the same "start at UT minus half the
        /// burn time" correction independently, because the stock type has
        /// nowhere to put it. These two instants are that nowhere, filled in.
        /// <see cref="ManeuverNode.Ut"/> is unchanged and is now documented as
        /// the impulsive-equivalent instant it always was.</para>
        ///
        /// <para><b>Absent duration, never zero duration.</b> A zero-duration
        /// burn carrying a thrust implies infinite acceleration, so a consumer
        /// computing thrust times duration over mass gets nonsense rather than
        /// an impulse. Absence is the true statement and it is what an unloaded
        /// craft will always report, since <c>VesselDeltaV.CheckDirtyAndRun</c>
        /// early-returns on <c>!loaded</c>.</para>
        ///
        /// <para><c>Frame</c> moves the delta-v basis out of prose and onto the
        /// wire. That was safe only while one basis existed; radial/normal/
        /// prograde and a Frenet tangent/normal/binormal are similar enough to
        /// be mistaken for each other and different enough to be wrong.
        /// Nullable because <c>RadialNormalPrograde</c> is index 0, so a
        /// defaulted value would assert the stock basis for components that
        /// might be in another. Null means nobody said (a pre-existing
        /// recording); <c>Unknown</c> means somebody said something we do not
        /// model, and only the second is a reason to distrust the
        /// components.</para>
        ///
        /// <para>No ordinal or predecessor field: <c>VesselManeuver.Nodes</c> is
        /// ordered by execution and that ordering already IS the plan. See
        /// <see cref="ManeuverNode.Patches"/> for the measured rule linking a
        /// burn to its input trajectory, which is documented rather than
        /// duplicated onto the wire.</para>
        /// </para>
        ///
        /// <para><b>Major-12 line, Bumped 15 -&gt; 16: the maneuver plan becomes
        /// an elected capability.</b> <see cref="VesselManeuver"/> gains
        /// <c>Planner</c>, nullable, additive.
        ///
        /// <para>It carries the elected provider's id, and its ABSENCE is the
        /// point: null means there is no planner at all, which is not the same
        /// fact as an empty plan and which stock reaches on its own, since an
        /// un-upgraded Tracking Station leaves <c>patchedConicSolver</c> null.
        /// Both previously arrived as <c>Nodes: []</c>, telling an operator
        /// their plan was empty when the truth was that they could not make
        /// one.</para>
        ///
        /// <para>Nothing outside the election may branch on the VALUE. A
        /// provider says what it is so a readout can name it and a diagnostic
        /// can record it, never so a consumer can special-case one;
        /// present-versus-null is the only part anything should test.</para>
        /// </para>
        /// </remarks>
        public const int Minor = 16;
    }
}
