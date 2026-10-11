using System;
using System.Collections.Generic;
using System.Reflection;
using System.Text.RegularExpressions;

namespace Sitrep.Contract;

/// <summary>
/// Why a command that ran was refused: the game looked and the answer was no.
///
/// <para>Two tiers. A root is declared only on <see cref="CommandErrorCode"/>
/// and the set of roots is closed, so every client can switch over it
/// exhaustively and every retry rule (resolves by waiting, permanent, fixable by
/// the operator) lives on one of them. A refinement names exactly one root and
/// says something more specific; it inherits the root's meaning, and a client
/// that has never seen it still reads its root. A refinement cannot itself be
/// refined.</para>
///
/// <para>On the wire a refusal is its root's id in <c>errorCode</c>, and a
/// refinement's own id in <c>reason</c>.</para>
/// </summary>
/// <category>Stream messages</category>
public sealed class RefusalCode : IEquatable<RefusalCode>
{
    private static readonly Regex RootId = new Regex("^[a-z][a-zA-Z0-9]*$", RegexOptions.CultureInvariant);
    private static readonly Regex RefinementId = new Regex("^[a-z][a-zA-Z0-9]*\\.[a-z][a-zA-Z0-9]*$", RegexOptions.CultureInvariant);

    private RefusalCode(string id, RefusalCode? refines, string sentence)
    {
        Id = id;
        Refines = refines;
        Sentence = sentence;
    }

    /// <summary>The camelCase id: one segment for a root, <c>owner.name</c> for a refinement.</summary>
    public string Id { get; }

    /// <summary>The root this refines, or null on a root.</summary>
    public RefusalCode? Refines { get; }

    /// <summary>What an operator reads after "refused:", lower case and without a full stop.</summary>
    public string Sentence { get; }

    /// <summary>The root: this code itself, or the one it refines.</summary>
    public RefusalCode Root => Refines ?? this;

    /// <summary>Whether this is a root.</summary>
    public bool IsRoot => Refines == null;

    /// <summary>The segment before the dot of a refinement's id: its owning Uplink or core domain. Empty on a root.</summary>
    public string Owner => IsRoot ? "" : Id.Substring(0, Id.IndexOf('.'));

    internal static RefusalCode DeclareRoot(string id, string sentence)
    {
        if (!RootId.IsMatch(id))
        {
            throw new ArgumentException("A root refusal id is one camelCase segment: '" + id + "'", nameof(id));
        }
        return new RefusalCode(id, null, RequireSentence(id, sentence));
    }

    /// <summary>
    /// A more specific refusal under this root, with its own sentence.
    ///
    /// <para><paramref name="id"/> is <c>owner.name</c>, and an Uplink's owner
    /// segment must be its own Uplink id: the host drops the code set of an
    /// Uplink that declares under anyone else's name.</para>
    /// </summary>
    public RefusalCode Refine(string id, string sentence)
    {
        if (!IsRoot)
        {
            throw new InvalidOperationException(
                "'" + Id + "' is already a refinement of '" + Root.Id + "', and a refinement cannot be refined. Refine '" + Root.Id + "' instead.");
        }
        if (id == null || !RefinementId.IsMatch(id))
        {
            throw new ArgumentException("A refinement id is owner.name, both camelCase: '" + id + "'", nameof(id));
        }
        return new RefusalCode(id, this, RequireSentence(id, sentence));
    }

    /// <summary>
    /// The code for an id read off the wire: the known root when there is one,
    /// otherwise an undeclared code carrying the id, and when
    /// <paramref name="reason"/> is a refinement, a code carrying that id under
    /// the root <paramref name="rootId"/> names.
    /// </summary>
    public static RefusalCode FromWire(string rootId, string? reason)
    {
        var root = CommandErrorCode.Find(rootId) ?? new RefusalCode(rootId, null, "");
        if (string.IsNullOrEmpty(reason)) return root;
        return new RefusalCode(reason!, root, "");
    }

    /// <summary>Two codes are the same code when their ids are.</summary>
    public bool Equals(RefusalCode? other) => other is not null && string.Equals(Id, other.Id, StringComparison.Ordinal);

    public override bool Equals(object? obj) => obj is RefusalCode other && Equals(other);

    public override int GetHashCode() => StringComparer.Ordinal.GetHashCode(Id);

    public override string ToString() => Id;

    /// <summary>Id equality; see <see cref="Equals(RefusalCode)"/>.</summary>
    public static bool operator ==(RefusalCode? a, RefusalCode? b) => a is null ? b is null : a.Equals(b);

    /// <summary>Id inequality; see <see cref="Equals(RefusalCode)"/>.</summary>
    public static bool operator !=(RefusalCode? a, RefusalCode? b) => !(a == b);

    internal static string RequireSentence(string id, string sentence)
    {
        if (string.IsNullOrWhiteSpace(sentence))
        {
            throw new ArgumentException("Every error code carries the sentence an operator reads: '" + id + "' has none", nameof(sentence));
        }
        return sentence;
    }
}

/// <summary>Where a <see cref="FaultCode"/> comes from.</summary>
public enum FaultOrigin
{
    /// <summary>From the mod, on an <c>error</c> frame.</summary>
    Mod,

    /// <summary>By a client's own transport, on a dispatch that never reached the mod or never came back.</summary>
    Client,
}

/// <summary>
/// Why a command, or any other request, could not be carried: nothing about the
/// game was decided. The refused/failed split is the kind of code, not a
/// judgement a client makes: a <see cref="RefusalCode"/> says the game said no,
/// this says the machinery did not get that far, and a retry may work.
///
/// <para>Closed, and declared only here. An Uplink never declares a fault: a
/// handler that throws already becomes <see cref="CommandUnavailable"/>, and
/// <see cref="CommandFaultException"/> is how a handler raises one of these
/// deliberately.</para>
/// </summary>
public sealed class FaultCode : IEquatable<FaultCode>
{
    private static readonly Regex IdPattern = new Regex("^[a-z][a-zA-Z0-9]*$", RegexOptions.CultureInvariant);

    private FaultCode(string id, FaultOrigin origin, string sentence)
    {
        Id = id;
        Origin = origin;
        Sentence = sentence;
    }

    /// <summary>The camelCase id, as <c>code</c> carries it.</summary>
    public string Id { get; }

    /// <summary>Whether the mod or a client raises it.</summary>
    public FaultOrigin Origin { get; }

    /// <summary>What an operator reads after "failed:", lower case and without a full stop.</summary>
    public string Sentence { get; }

    private static FaultCode Mod(string id, string sentence) => Declare(id, FaultOrigin.Mod, sentence);

    private static FaultCode Client(string id, string sentence) => Declare(id, FaultOrigin.Client, sentence);

    private static FaultCode Declare(string id, FaultOrigin origin, string sentence)
    {
        if (!IdPattern.IsMatch(id))
        {
            throw new ArgumentException("A fault id is one camelCase segment: '" + id + "'", nameof(id));
        }
        return new FaultCode(id, origin, RefusalCode.RequireSentence(id, sentence));
    }

    /// <summary>A frame of a known type that could not be read, including a <c>command-request</c> whose <c>args</c> do not fit the command. Only that call is refused; the command stays available.</summary>
    public static readonly FaultCode InvalidEnvelope = Mod("invalidEnvelope", "the request could not be read");

    /// <summary>A frame whose <c>type</c> this build does not recognise.</summary>
    public static readonly FaultCode UnknownEnvelopeType = Mod("unknownEnvelopeType", "the mod does not recognise that kind of request");

    /// <summary>A frame that parsed as a type this build has nothing to do with.</summary>
    public static readonly FaultCode UnhandledEnvelope = Mod("unhandledEnvelope", "the mod has nothing to do with that request");

    /// <summary>A binary frame sent up the socket, which nothing accepts.</summary>
    public static readonly FaultCode BinaryFrameNotAccepted = Mod("binaryFrameNotAccepted", "the mod accepts no binary frames");

    /// <summary>A command that is unknown or unavailable, or whose handler threw. A handler that threw leaves its command unavailable for the session.</summary>
    public static readonly FaultCode CommandUnavailable = Mod("commandUnavailable", "the command is not available");

    /// <summary>
    /// A command the host could not run in time: it was handed to the game's
    /// main thread and the game did not take it before the host stopped
    /// waiting, as during a scene load. Nothing was decided, and the command
    /// may still run later.
    /// </summary>
    public static readonly FaultCode MainThreadTimeout = Mod("mainThreadTimeout", "the game did not get to it in time");

    /// <summary>A command that ran and whose result could not be written.</summary>
    public static readonly FaultCode ResultSerializationError = Mod("resultSerializationError", "its answer could not be sent");

    /// <summary>A subscription to a topic nothing declares.</summary>
    public static readonly FaultCode UnknownTopic = Mod("unknownTopic", "nothing publishes that");

    /// <summary>A topic whose payload could not be written.</summary>
    public static readonly FaultCode PayloadSerializationError = Mod("payloadSerializationError", "its value could not be sent");

    /// <summary>A <c>set-vantage</c>, or a command's <c>vantage</c>, naming a command centre that is not active. The alarm command for a SCET alarm (an alarm on the craft's own clock, spacecraft event time) is the exception: it refuses an inactive vantage with the <c>range</c> refusal instead.</summary>
    public static readonly FaultCode UnknownVantage = Mod("unknownVantage", "that command centre is not active");

    /// <summary>A held command reached its expiry, or its place on the lane passed, before it could run. A lane is the numbered sequence of commands to one craft, which the craft settles in number order.</summary>
    public static readonly FaultCode CommandExpired = Mod("commandExpired", "it expired before it could run");

    /// <summary>
    /// A command sent in a group was not sent because another command in the same
    /// group was refused, or because the group itself could not be sent. A group
    /// goes whole or not at all, so every member is refused with this one, and the
    /// message names the member that decided it.
    /// </summary>
    public static readonly FaultCode GroupRefused = Mod("groupRefused", "a command sent with it was refused, so it was not sent or run");

    /// <summary>
    /// A command sent in a group did not run because an earlier command in the
    /// same group failed at the craft. The earlier commands stay done, since a
    /// game action cannot be taken back; the message says which ran.
    /// </summary>
    public static readonly FaultCode GroupStopped = Mod("groupStopped", "an earlier command sent with it failed, so it did not run");

    /// <summary>A cancel stopped the command before it ran.</summary>
    public static readonly FaultCode CommandCancelled = Mod("commandCancelled", "it was cancelled before it ran");

    /// <summary>
    /// A game load started a new timeline while the command was on its way,
    /// and the save it loaded does not carry the command, so it will not run.
    /// A quickload to before the command was sent is the common case. A
    /// command the loaded save does carry stays on its way and is answered as
    /// usual.
    /// </summary>
    public static readonly FaultCode UndoneByLoad = Mod("undoneByLoad", "a game load undid it before it ran");

    /// <summary>
    /// A continuous input, a throttle or a control axis, was dropped at a node,
    /// a ground station or relay on the route to the craft, because the link
    /// onward was down there and it would have had to be held until it came
    /// back. Held and sent on later it would arrive as a run of out-of-date
    /// values, so a node that cannot send it on at once drops it. It was
    /// accepted with a warning when it was sent, and this is the news of its
    /// loss, arriving at the command centre that sent it once a report from that
    /// node could have reached it at light speed.
    /// </summary>
    public static readonly FaultCode ContinuousInputWouldWait = Mod("continuousInputWouldWait", "it would wait on its way, and a continuous input cannot");

    /// <summary>The transport held the command for a link that never came back, and has stopped retrying. It never left this machine.</summary>
    public static readonly FaultCode Undelivered = Client("undelivered", "it was never sent");

    /// <summary>The client was shut down while the command waited for an answer.</summary>
    public static readonly FaultCode Disposed = Client("disposed", "the connection closed before an answer came");

    /// <summary>The transport's queue of commands waiting for a link is full, so this one was not queued.</summary>
    public static readonly FaultCode SendQueueFull = Client("sendQueueFull", "too many commands are waiting for the link");

    /// <summary>A station's link to the main screen dropped while the command was on it.</summary>
    public static readonly FaultCode PeerDisconnected = Client("peerDisconnected", "the link to the main screen dropped");

    /// <summary>The main screen had no connection to the mod to relay a station's command over.</summary>
    public static readonly FaultCode NoClient = Client("noClient", "the main screen is not connected to the game");

    /// <summary>A rejection that carried no code a client could read, such as a throw from inside a handler on the client.</summary>
    public static readonly FaultCode Unclassified = Client("unclassified", "something went wrong");

    private static readonly Dictionary<string, FaultCode> ById = IndexById();

    /// <summary>Every fault, in declaration order.</summary>
    public static IReadOnlyList<FaultCode> All => ErrorCodeCatalog.FaultsOf(typeof(FaultCode));

    /// <summary>The declared fault with this id, or null.</summary>
    public static FaultCode? Find(string id) => id != null && ById.TryGetValue(id, out var code) ? code : null;

    /// <summary>The code for an id read off the wire: the declared fault, or an undeclared one carrying the id.</summary>
    public static FaultCode FromWire(string id) => Find(id) ?? new FaultCode(id, FaultOrigin.Mod, "");

    private static Dictionary<string, FaultCode> IndexById()
    {
        var byId = new Dictionary<string, FaultCode>(StringComparer.Ordinal);
        foreach (var code in ErrorCodeCatalog.FaultsOf(typeof(FaultCode))) byId[code.Id] = code;
        return byId;
    }

    /// <summary>Two codes are the same code when their ids are.</summary>
    public bool Equals(FaultCode? other) => other is not null && string.Equals(Id, other.Id, StringComparison.Ordinal);

    public override bool Equals(object? obj) => obj is FaultCode other && Equals(other);

    public override int GetHashCode() => StringComparer.Ordinal.GetHashCode(Id);

    public override string ToString() => Id;

    /// <summary>Id equality; see <see cref="Equals(FaultCode)"/>.</summary>
    public static bool operator ==(FaultCode? a, FaultCode? b) => a is null ? b is null : a.Equals(b);

    /// <summary>Id inequality; see <see cref="Equals(FaultCode)"/>.</summary>
    public static bool operator !=(FaultCode? a, FaultCode? b) => !(a == b);
}

/// <summary>
/// Thrown by a command handler to reply with a <see cref="FaultCode"/> rather
/// than a result: the host sends an <c>error</c> frame carrying it and, unlike
/// any other throw, leaves the command available.
/// </summary>
public sealed class CommandFaultException : Exception
{
    /// <summary>A fault with the machinery's own account of it, for a log rather than an operator.</summary>
    public CommandFaultException(FaultCode code, string message)
        : base(message)
    {
        Code = code ?? throw new ArgumentNullException(nameof(code));
    }

    /// <summary>The fault the command replies with.</summary>
    public FaultCode Code { get; }
}

/// <summary>
/// Reads the codes a holder class declares as public static fields. Set
/// <see cref="UplinkManifest.ErrorCodes"/> with <see cref="Of"/>.
/// <internal>
/// A manifest, the generator and the gates all read the static fields
/// themselves, so nothing restates the codes by hand.
/// </internal>
/// </summary>
public static class ErrorCodeCatalog
{
    /// <summary>Every <see cref="RefusalCode"/> declared as a public static field of <paramref name="holder"/>, in declaration order.</summary>
    public static IReadOnlyList<RefusalCode> Of(Type holder) => FieldsOf<RefusalCode>(holder);

    /// <summary>Every <see cref="FaultCode"/> declared as a public static field of <paramref name="holder"/>, in declaration order.</summary>
    public static IReadOnlyList<FaultCode> FaultsOf(Type holder) => FieldsOf<FaultCode>(holder);

    /// <summary>The public static fields of <paramref name="holder"/> holding a <typeparamref name="T"/>, with their C# names, in declaration order.</summary>
    public static IReadOnlyList<(string Name, T Code)> NamedFieldsOf<T>(Type holder)
        where T : class
    {
        var named = new List<(string, T)>();
        foreach (var field in holder.GetFields(BindingFlags.Public | BindingFlags.Static | BindingFlags.DeclaredOnly))
        {
            if (field.FieldType != typeof(T)) continue;
            if (field.GetValue(null) is T code) named.Add((field.Name, code));
        }
        named.Sort((a, b) => MetadataOrder(holder, a.Item1).CompareTo(MetadataOrder(holder, b.Item1)));
        return named;
    }

    private static IReadOnlyList<T> FieldsOf<T>(Type holder)
        where T : class
    {
        var codes = new List<T>();
        foreach (var (_, code) in NamedFieldsOf<T>(holder)) codes.Add(code);
        return codes;
    }

    private static int MetadataOrder(Type holder, string fieldName) =>
        holder.GetField(fieldName, BindingFlags.Public | BindingFlags.Static | BindingFlags.DeclaredOnly)!.MetadataToken;
}
