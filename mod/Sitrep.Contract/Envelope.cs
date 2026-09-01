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
    /// session <c>SelectedVantage</c> (the default). A program-meta command
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
/// and the command-dispatch vantage. <c>"ksc"</c> (the default) is always
/// selectable; any other id must name a currently-active command centre.
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
