using Reinforced.Typings.Attributes;

namespace Sitrep.Contract;

[TsInterface]
public class StreamData<T>
{
    [TsProperty(Type = "\"stream-data\"")] public string Type { get; set; } = "stream-data";
    public string Topic { get; set; } = "";
    public T Payload { get; set; } = default!;
    public Meta Meta { get; set; } = new();
}

[TsInterface]
public class EventMsg
{
    [TsProperty(Type = "\"event\"")] public string Type { get; set; } = "event";
    public string Topic { get; set; } = "";
    public string Name { get; set; } = "";
    public Meta Meta { get; set; } = new();
}

[TsInterface]
public class CommandRequest<TArgs>
{
    [TsProperty(Type = "\"command-request\"")] public string Type { get; set; } = "command-request";
    public string RequestId { get; set; } = "";
    public string Command { get; set; } = "";
    public TArgs Args { get; set; } = default!;
    public double SentAt { get; set; }
}

[TsInterface]
public class CommandResponse<TResult>
{
    [TsProperty(Type = "\"command-response\"")] public string Type { get; set; } = "command-response";
    public string RequestId { get; set; } = "";
    public TResult Result { get; set; } = default!;
    public Meta Meta { get; set; } = new();
}

[TsInterface]
public class ErrorMsg
{
    [TsProperty(Type = "\"error\"")] public string Type { get; set; } = "error";
    public string? RequestId { get; set; }
    public string? Topic { get; set; }
    public string Code { get; set; } = "";
    public string Message { get; set; } = "";
}

[TsInterface]
public class Subscribe
{
    [TsProperty(Type = "\"subscribe\"")] public string Type { get; set; } = "subscribe";
    public string Topic { get; set; } = "";
}

[TsInterface]
public class Unsubscribe
{
    [TsProperty(Type = "\"unsubscribe\"")] public string Type { get; set; } = "unsubscribe";
    public string Topic { get; set; } = "";
}
