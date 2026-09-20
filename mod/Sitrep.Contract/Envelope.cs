#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class StreamData<T>
{
#if SITREP_CODEGEN
    [TsProperty(Type = "\"stream-data\"")]
#endif
    [SitrepUnit(Units.Id)]
    public string Type { get; set; } = "stream-data";
    [SitrepUnit(Units.Id)]
    public string Topic { get; set; } = "";
    public T Payload { get; set; } = default!;
    public Meta Meta { get; set; } = new();
}

[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class EventMsg
{
#if SITREP_CODEGEN
    [TsProperty(Type = "\"event\"")]
#endif
    [SitrepUnit(Units.Id)]
    public string Type { get; set; } = "event";
    [SitrepUnit(Units.Id)]
    public string Topic { get; set; } = "";
    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";
    public Meta Meta { get; set; } = new();
}

[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommandRequest<TArgs>
{
#if SITREP_CODEGEN
    [TsProperty(Type = "\"command-request\"")]
#endif
    [SitrepUnit(Units.Id)]
    public string Type { get; set; } = "command-request";
    [SitrepUnit(Units.Id)]
    public string RequestId { get; set; } = "";
    [SitrepUnit(Units.Id)]
    public string Command { get; set; } = "";

    /// <summary>
    /// Caller-supplied, generic display label for this dispatch, carried
    /// verbatim into the corresponding <see cref="Sitrep.Contract.PendingUplink.Label"/>
    /// entry on <c>system.uplink.pending</c>. Empty ⇒ the renderer falls back
    /// to <see cref="Command"/>. Never inspected/parsed by the engine.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string Label { get; set; } = "";

    /// <summary>
    /// Dispatch-time addressing: carried verbatim into the corresponding
    /// <see cref="Sitrep.Contract.PendingUplink.Topic"/> entry on
    /// <c>system.uplink.pending</c>. Never inspected/parsed by the engine.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Topic { get; set; } = "";

    /// <summary>
    /// Per-call vantage override (Plan 3 / delay-UX): the command centre this
    /// specific command dispatches from, governing its delay via
    /// <c>DelayTo(vantage, node)</c>. Empty ⇒ the server uses the connection's
    /// own vantage (see <see cref="SetVantage"/>). A program-meta command
    /// (tech/strategy/contract) sends <c>"meta"</c> so it stays instant
    /// (<c>DelayTo("meta", *) = 0</c>) regardless of which centre the operator
    /// has selected. Nullable/optional: a pre-Vantage client omits it (codegen
    /// emits vantage?: string), and the server treats null/empty as the session vantage.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? Vantage { get; set; }

    public TArgs Args { get; set; } = default!;

    /// <summary>
    /// When the client dispatched, in UT seconds (KSP universal time), the same
    /// base as <see cref="Meta.ValidAt"/>. The declaration reaches a client
    /// through the units map rather than through the emitted type: the
    /// <c>Value&lt;"ut"&gt;</c> retyping pass runs over wire PAYLOAD types only,
    /// so every command-args and envelope field stays a bare number in
    /// <c>contract.ts</c> and carries its unit in <c>units.json</c>.
    ///
    /// <b>Every client sends 0 today.</b> The dispatching client has no UT to
    /// hand at that point that the server would not know better, and the server
    /// stamps the response's <see cref="Meta.DeliveredAt"/> off its own clock,
    /// so a caller wanting a round-trip measures against its own view time
    /// rather than reading this back. The field is carried onto a response's
    /// <see cref="Meta.ValidAt"/>, which therefore reads 0 on a command
    /// response: nothing consumes that today, and a consumer that starts to
    /// must make the client fill this in first.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double SentAt { get; set; }
}

[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommandResponse<TResult>
{
#if SITREP_CODEGEN
    [TsProperty(Type = "\"command-response\"")]
#endif
    [SitrepUnit(Units.Id)]
    public string Type { get; set; } = "command-response";
    [SitrepUnit(Units.Id)]
    public string RequestId { get; set; } = "";
    public TResult Result { get; set; } = default!;
    public Meta Meta { get; set; } = new();
}

/// <summary>
/// Sent the moment the engine takes a dispatch onto the delayed path, carrying
/// the one-way light-time it will actually travel. It says THE COMMAND IS ON
/// ITS WAY AND HERE IS WHEN TO EXPECT AN ANSWER, never that anything executed.
///
/// <para>A client cannot work this out for itself. The delay depends on the
/// node the command is addressed to, which the engine resolves from the
/// command's declared subject, and on the vantage it was sent from: a client
/// sizing a loss deadline from the delay it can see (the active craft's) grades
/// a command to a different node against the wrong path entirely.</para>
///
/// <para>Correlated by <see cref="RequestId"/>, the client's own id off its
/// <c>command-request</c>. That is safe here and is NOT safe on
/// <c>system.uplink.pending</c>, whose entries carry an engine-minted id
/// instead: two clients can choose the same request id, so a broadcast channel
/// cannot pair them, whereas this frame travels back down the one socket that
/// sent the request.</para>
///
/// <para>Absent for a dispatch that never rides light-time (a
/// <c>TrueNow</c> command, or a live delay resolving to zero), because there is
/// no flight to wait out. Absent also for a refusal, which sends an
/// <see cref="ErrorMsg"/> instead. A client must therefore treat "no acceptance
/// yet" as ordinary rather than as an error.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommandAccepted
{
#if SITREP_CODEGEN
    [TsProperty(Type = "\"command-accepted\"")]
#endif
    [SitrepUnit(Units.Id)]
    public string Type { get; set; } = "command-accepted";

    /// <summary>The client's own id, echoed from its <c>command-request</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string RequestId { get; set; } = "";

    /// <summary>
    /// One-way light-time from the sending vantage to the node this command is
    /// addressed to, as the engine's ledger has it AT DISPATCH. Frozen: a route
    /// change afterwards is discrete and the sender may never learn of it, so
    /// this is not re-sent.
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double OneWaySeconds { get; set; }
}

[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ErrorMsg
{
#if SITREP_CODEGEN
    [TsProperty(Type = "\"error\"")]
#endif
    [SitrepUnit(Units.Id)]
    public string Type { get; set; } = "error";
    [SitrepUnit(Units.Id)]
    public string? RequestId { get; set; }
    [SitrepUnit(Units.Id)]
    public string? Topic { get; set; }
    [SitrepUnit(Units.Id)]
    public string Code { get; set; } = "";
    [SitrepUnit(Units.Text)]
    public string Message { get; set; } = "";
}

[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Subscribe
{
#if SITREP_CODEGEN
    [TsProperty(Type = "\"subscribe\"")]
#endif
    [SitrepUnit(Units.Id)]
    public string Type { get; set; } = "subscribe";
    [SitrepUnit(Units.Id)]
    public string Topic { get; set; } = "";
}

[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Unsubscribe
{
#if SITREP_CODEGEN
    [TsProperty(Type = "\"unsubscribe\"")]
#endif
    [SitrepUnit(Units.Id)]
    public string Type { get; set; } = "unsubscribe";
    [SitrepUnit(Units.Id)]
    public string Topic { get; set; } = "";
}

/// <summary>
/// Client-to-server: select the command centre this connection commands from and
/// observes at (Plan 3 vantage selection). Governs both the downlink cursor read
/// and the command-dispatch vantage. The id must name a currently-active command
/// centre, or the request is refused with an <c>unknown-vantage</c> error and the
/// connection keeps the vantage it had.
///
/// <para>A connection that has never sent one observes at the home command (the
/// roster entry whose <c>isHome</c> is true), and follows it if home moves. When
/// no home is identified it observes at the first ground station in ordinal id
/// order, and while no command centre is active at all (the main menu) at none,
/// stamping its frames with an empty <c>vantage</c>. Every frame's
/// <c>meta.vantage</c> says which of these is in force.</para>
/// </summary>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class SetVantage
{
#if SITREP_CODEGEN
    [TsProperty(Type = "\"set-vantage\"")]
#endif
    [SitrepUnit(Units.Id)]
    public string Type { get; set; } = "set-vantage";

    /// <summary>The command centre Id to adopt as this connection's vantage.</summary>
    [SitrepUnit(Units.Id)]
    public string CentreId { get; set; } = "";
}
