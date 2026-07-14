#if NETSTANDARD2_0
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class StreamData<T>
{
#if NETSTANDARD2_0
    [TsProperty(Type = "\"stream-data\"")]
#endif
    public string Type { get; set; } = "stream-data";
    public string Topic { get; set; } = "";
    public T Payload { get; set; } = default!;
    public Meta Meta { get; set; } = new();
}

[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class EventMsg
{
#if NETSTANDARD2_0
    [TsProperty(Type = "\"event\"")]
#endif
    public string Type { get; set; } = "event";
    public string Topic { get; set; } = "";
    public string Name { get; set; } = "";
    public Meta Meta { get; set; } = new();
}

[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class CommandRequest<TArgs>
{
#if NETSTANDARD2_0
    [TsProperty(Type = "\"command-request\"")]
#endif
    public string Type { get; set; } = "command-request";
    public string RequestId { get; set; } = "";
    public string Command { get; set; } = "";

    /// <summary>
    /// Caller-supplied, generic display label for this dispatch — carried
    /// verbatim into the corresponding <see cref="Sitrep.Contract.PendingUplink.Label"/>
    /// entry on <c>system.uplink.pending</c>. Empty ⇒ the renderer falls back
    /// to <see cref="Command"/>. Never inspected/parsed by the engine.
    /// </summary>
    public string Label { get; set; } = "";

    /// <summary>
    /// Dispatch-time addressing — carried verbatim into the corresponding
    /// <see cref="Sitrep.Contract.PendingUplink.Topic"/> entry on
    /// <c>system.uplink.pending</c>. Never inspected/parsed by the engine.
    /// </summary>
    public string Topic { get; set; } = "";
    public TArgs Args { get; set; } = default!;
    public double SentAt { get; set; }
}

[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class CommandResponse<TResult>
{
#if NETSTANDARD2_0
    [TsProperty(Type = "\"command-response\"")]
#endif
    public string Type { get; set; } = "command-response";
    public string RequestId { get; set; } = "";
    public TResult Result { get; set; } = default!;
    public Meta Meta { get; set; } = new();
}

[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class ErrorMsg
{
#if NETSTANDARD2_0
    [TsProperty(Type = "\"error\"")]
#endif
    public string Type { get; set; } = "error";
    public string? RequestId { get; set; }
    public string? Topic { get; set; }
    public string Code { get; set; } = "";
    public string Message { get; set; } = "";
}

[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class Subscribe
{
#if NETSTANDARD2_0
    [TsProperty(Type = "\"subscribe\"")]
#endif
    public string Type { get; set; } = "subscribe";
    public string Topic { get; set; } = "";
}

[SitrepContract]
#if NETSTANDARD2_0
[TsInterface]
#endif
public class Unsubscribe
{
#if NETSTANDARD2_0
    [TsProperty(Type = "\"unsubscribe\"")]
#endif
    public string Type { get; set; } = "unsubscribe";
    public string Topic { get; set; } = "";
}
