namespace Sitrep.Contract
{
    /// <summary>
    /// The Uplink ABI's version — see
    /// <c>local_docs/telemetry-mod/uplink-versioning-research.md</c>. This is
    /// intentionally a bare <c>const int</c> pair, not a struct/semver type:
    /// every consumer that needs "what contract version was I built against"
    /// (see <see cref="SitrepUplinkAttribute"/>'s default constructor
    /// arguments) relies on the C# compiler inlining a <c>const</c> at the
    /// CALL SITE, at COMPILE time — a struct/property read would instead
    /// resolve against the CALLER's loaded copy of this assembly, defeating
    /// the whole point of stamping "what version this Uplink was built
    /// against" into an old, un-recompiled binary.
    ///
    /// <see cref="Major"/> bumps are BREAKING (removed/renamed/retyped
    /// members on a wire-visible <c>[TsInterface]</c> type — the CI "lying
    /// minor" gate, see <c>local_docs/telemetry-mod/uplink-versioning-research.md</c>,
    /// fails the build on exactly this unless <see cref="Major"/> bumps in
    /// the same commit). <see cref="Minor"/> bumps are additive-only (new
    /// field/type) and never break an Uplink built against an older Minor of
    /// the same Major.
    /// </summary>
    public static class ContractVersion
    {
        /// <summary>
        /// Bumped 1 -&gt; 2 (Minor reset to 0): the R7 pre-release contract
        /// consolidation. Collapsed the three hand-rolled command result
        /// records (<c>Ack</c>/<c>StageResult</c>/<c>AddManeuverNodeResult</c>)
        /// into one generic <see cref="CommandResult"/>/<see cref="CommandResult{T}"/>
        /// with a typed <see cref="CommandErrorCode"/> enum replacing the bare
        /// <c>string</c> error codes — REMOVING/renaming
        /// <see cref="SitrepContractAttribute"/>-marked types, which the shape
        /// gate correctly flags as breaking. Also made
        /// <c>VesselTarget.RelativeVelocity</c> nullable and added
        /// <c>ResourceAmount.Active</c> (both additive, riding the same bump).
        /// Sanctioned because the mod is pre-release with NO external Uplinks
        /// yet — every bundled uplink rebuilds together against the new shape.
        /// See <c>.superpowers/sdd/r7-contract-fixes-brief.md</c>.
        /// </summary>
        public const int Major = 2;

        /// <summary>
        /// Reset to 0 alongside the Major 1 -&gt; 2 bump (see <see cref="Major"/>).
        /// The Minor history below (0-&gt;1-&gt;2-&gt;3) belongs to the Major-1
        /// line and is retained for provenance; every one of those additive
        /// changes is carried forward into Major 2.
        ///
        /// <para>Major-1 history — Bumped 0 -&gt; 1: additive-only Minor for dynamic-namespace channel
        /// registration (<see cref="IUplinkHost.RegisterDynamicNamespace"/>/
        /// <see cref="IDynamicChannelSource"/>) plus per-channel
        /// <see cref="ChannelDeclaration.Delay"/> disposition. Neither
        /// touches an existing <see cref="ISitrepUplink"/>'s compile-time
        /// surface — see <c>.superpowers/sdd/contract-dynamic-delay-report.md</c>.</para>
        ///
        /// <para>Bumped 1 -&gt; 2: additive-only Minor for the
        /// capture-on-main / handle-on-Courier seam
        /// (<see cref="IUplinkHost.AddSampledSource"/>) — a new method on
        /// <see cref="IUplinkHost"/> (which an Uplink CONSUMES, never
        /// implements), so it cannot break any existing
        /// <see cref="ISitrepUplink"/> built against an older Minor. See
        /// <c>.superpowers/sdd/f1-main-thread-sampler-report.md</c>.</para>
        ///
        /// <para>Bumped 2 -&gt; 3: additive-only Minor for the
        /// subscription-gated <see cref="IUplinkHost.AddSampledSource(System.Func{KspSnapshot?, object?}, System.Action{object?}, string[])"/>
        /// overload — a new method on <see cref="IUplinkHost"/> (which an Uplink
        /// CONSUMES, never implements), so it cannot break any existing
        /// <see cref="ISitrepUplink"/> built against an older Minor. See
        /// <c>.superpowers/sdd/f1-hardening-report.md</c>.</para>
        ///
        /// <para>Major-2 line — Bumped 0 -&gt; 1: additive-only Minor adding the
        /// <see cref="CommandErrorCode.Timeout"/> member (the F2-fix pause/
        /// scene-load backstop failure code). A new enum member cannot break an
        /// Uplink built against an older Minor — see
        /// <c>.superpowers/sdd/f2-fix-brief.md</c>.</para>
        ///
        /// <para>Bumped 1 -&gt; 2: additive-only Minor adding the comms.* wire
        /// contract (U2 — comms trio): the <see cref="CommsConnectivity"/>/
        /// <see cref="CommsSignalStrength"/>/<see cref="CommsControlState"/>/
        /// <see cref="CommsPath"/>/<see cref="CommsHop"/>/<see cref="CommsNetwork"/>
        /// (+ node/edge)/<see cref="CommsDelay"/>/<see cref="CommsLinkQuality"/>/
        /// <see cref="CommsDataRate"/>/<see cref="CommsLinkMargin"/> payloads and
        /// their enums (<see cref="CommsControlSource"/>/
        /// <see cref="CommsControlStateKind"/>/<see cref="CommsHopKind"/>/
        /// <see cref="CommsDelaySource"/>). All brand-new types — additive, so it
        /// cannot break an Uplink built against an older Minor. The
        /// <see cref="ICommsBackend"/> capability seam is NOT a wire type (no
        /// <see cref="SitrepContractAttribute"/>) — it is the pure Kernel-elected
        /// object, so it never appears in the shape baseline. See
        /// <c>local_docs/telemetry-mod/comms-uplink-design.md</c>.</para>
        /// </summary>
        public const int Minor = 2;
    }
}
