#if SITREP_CODEGEN
using Reinforced.Typings.Attributes;
#endif

namespace Sitrep.Contract;

/// <summary>
/// One Topic sample as the server sends it: the Topic id, its payload, and
/// the envelope <see cref="Meta"/> saying when the payload was true and when
/// it arrived.
/// </summary>
/// <category>Stream messages</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class StreamData<T>
{
    /// <summary>The frame type, always <c>"stream-data"</c>.</summary>
#if SITREP_CODEGEN
    [TsProperty(Type = "\"stream-data\"")]
#endif
    [SitrepUnit(Units.Id)]
    public string Type { get; set; } = "stream-data";
    /// <summary>The Topic id this sample belongs to.</summary>
    [SitrepUnit(Units.Id)]
    public string Topic { get; set; } = "";
    /// <summary>The sample itself, in the Topic's own payload type.</summary>
    public T Payload { get; set; } = default!;
    /// <summary>When the sample was true, when it arrived, and where it was
    /// observed from.</summary>
    public Meta Meta { get; set; } = new();
}

/// <summary>
/// Something that happened to a subscription, sent on the Topic it happened to.
///
/// <para>An event carries no payload of its own: <see cref="Name"/> is the whole
/// of what happened, and <see cref="Meta"/> describes the delivery as it does on
/// any other frame. The mod sends two names:</para>
/// <list type="bullet">
/// <item><c>subscribed</c> confirms a <c>subscribe</c>, once per subscribe. Wait
/// for it rather than for the first <c>stream-data</c>: a channel with nothing to
/// say yet sends the confirmation and then nothing. A <c>subscribe</c> naming a
/// Topic nothing owns gets no reply at all, not an error, so a missing
/// confirmation is how a client learns the Topic is unowned</item>
/// <item><c>timeline-reset</c> says the game quickloaded and time went backwards.
/// It is sent for every Topic the connection holds, and anything built from
/// frames before it should be discarded</item>
/// </list>
/// </summary>
/// <category>Stream messages</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class EventMsg
{
    /// <summary>The frame type, always <c>"event"</c>.</summary>
#if SITREP_CODEGEN
    [TsProperty(Type = "\"event\"")]
#endif
    [SitrepUnit(Units.Id)]
    public string Type { get; set; } = "event";
    /// <summary>The subscribed Topic the event happened to.</summary>
    [SitrepUnit(Units.Id)]
    public string Topic { get; set; } = "";
    /// <summary>What happened: <c>subscribed</c> or
    /// <c>timeline-reset</c>.</summary>
    [SitrepUnit(Units.Text)]
    public string Name { get; set; } = "";
    /// <summary>The delivery metadata, as on any other frame.</summary>
    public Meta Meta { get; set; } = new();
}

/// <summary>
/// A command the client sends: the command id, its arguments, and a
/// request id that the reply carries back.
/// </summary>
/// <category>Stream messages</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommandRequest<TArgs>
{
    /// <summary>The frame type, always <c>"command-request"</c>.</summary>
#if SITREP_CODEGEN
    [TsProperty(Type = "\"command-request\"")]
#endif
    [SitrepUnit(Units.Id)]
    public string Type { get; set; } = "command-request";
    /// <summary>An id the client chooses; the reply carries it back.</summary>
    [SitrepUnit(Units.Id)]
    public string RequestId { get; set; } = "";
    /// <summary>The command id, such as
    /// <c>vessel.control.setThrottle</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string Command { get; set; } = "";

    /// <summary>
    /// A display label the caller chooses for this dispatch, carried verbatim
    /// into the matching <see cref="PendingUplink.Label"/> on
    /// <c>system.uplink.pending</c>. When empty, show <see cref="Command"/>
    /// instead. The mod never reads or parses it.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string Label { get; set; } = "";

    /// <summary>
    /// A Topic the caller associates with this dispatch, carried verbatim into
    /// the matching <see cref="PendingUplink.Topic"/> on
    /// <c>system.uplink.pending</c>. The mod never reads or parses it.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Topic { get; set; } = "";

    /// <summary>
    /// Per-call vantage override: the command centre id this command dispatches
    /// from, which decides its signal delay. Optional: null or empty uses the
    /// connection's own vantage (see <see cref="SetVantage"/>). A program-level
    /// command (tech, strategy, contract) sends <c>"meta"</c>, which carries no
    /// delay whichever centre the operator has selected. A centre that is not
    /// active is refused with an <c>unknown-vantage</c> error.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string? Vantage { get; set; }

    /// <summary>The command's arguments, in the command's own argument
    /// type.</summary>
    public TArgs Args { get; set; } = default!;

    /// <summary>
    /// When the client dispatched, in UT seconds (KSP universal time), the same
    /// base as <see cref="Meta.ValidAt"/>. A bare number in the TypeScript type,
    /// like every envelope field; its unit is declared in the SDK's units map.
    ///
    /// <para><b>The shipped clients send 0.</b> The server stamps the response's
    /// <see cref="Meta.DeliveredAt"/> off its own clock, so a caller wanting a
    /// round-trip measures against its own view time rather than reading this
    /// back. The field is carried onto the response's
    /// <see cref="Meta.ValidAt"/>, which therefore reads 0 on a command response
    /// unless the client fills this in.</para>
    /// <internal>
    /// The <c>Value&lt;"ut"&gt;</c> retyping pass runs over wire PAYLOAD types
    /// only, so this stays a bare number in <c>contract.ts</c> and carries its
    /// unit in <c>units.json</c>.
    /// </internal>
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double SentAt { get; set; }
}

/// <summary>
/// The server's reply to a <see cref="CommandRequest{TArgs}"/>, matched to it
/// by <see cref="RequestId"/>.
/// </summary>
/// <category>Stream messages</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommandResponse<TResult>
{
    /// <summary>The frame type, always <c>"command-response"</c>.</summary>
#if SITREP_CODEGEN
    [TsProperty(Type = "\"command-response\"")]
#endif
    [SitrepUnit(Units.Id)]
    public string Type { get; set; } = "command-response";
    /// <summary>
    /// The id from the request this replies to. It is the only link back to the
    /// request, and a delayed command's reply can arrive minutes later.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string RequestId { get; set; } = "";
    /// <summary>What the command returned, in the command's own reply
    /// type.</summary>
    public TResult Result { get; set; } = default!;
    /// <summary>The delivery metadata, as on any other frame.</summary>
    public Meta Meta { get; set; } = new();
}

/// <summary>
/// Sent the moment the engine takes a dispatch onto the delayed path, carrying
/// the one-way light-time it will actually travel. It says THE COMMAND IS ON
/// ITS WAY AND HERE IS WHEN TO EXPECT A REPLY, never that anything executed.
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
/// <category>Stream messages</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class CommandAccepted
{
    /// <summary>The frame type, always <c>"command-accepted"</c>.</summary>
#if SITREP_CODEGEN
    [TsProperty(Type = "\"command-accepted\"")]
#endif
    [SitrepUnit(Units.Id)]
    public string Type { get; set; } = "command-accepted";

    /// <summary>The client's own id, echoed from its
    /// <c>command-request</c>.</summary>
    [SitrepUnit(Units.Id)]
    public string RequestId { get; set; } = "";

    /// <summary>
    /// One-way light-time from the sending vantage to the node this command is
    /// addressed to, as the engine's ledger has it AT DISPATCH. Frozen: a route
    /// change afterwards is discrete and the sender may never learn of it, so
    /// this is not re-sent.
    ///
    /// <para>For a command held and forwarded on a lane it is how long the
    /// sending centre's own plan expects it to take to reach the craft, waits
    /// included, and absent when that plan knows no route, as for a craft
    /// the centre has not heard from yet. It is what the centre believed when
    /// it sent, and says nothing of whether the craft is really
    /// listening.</para>
    /// </summary>
    [SitrepUnit(Units.Seconds)]
    public double? OneWaySeconds { get; set; }

    /// <summary>
    /// When the engine predicts the reply will come back, from the routes at
    /// dispatch, waits included. A client times its loss deadline from this when
    /// present, since a command held for a window replies long after twice the
    /// one-way time. Absent when no route was predicted.
    /// </summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? PredictedReplyUt { get; set; }

    /// <summary>When the command is deleted wherever it is, if it has not run. Absent for a command that is not held at all.</summary>
    [SitrepUnit(Units.UniversalTime)]
    public double? ExpiresAtUt { get; set; }

    /// <summary>
    /// What the operator should know about a command that was accepted anyway,
    /// as a sentence to show them. Present for a continuous input, a throttle
    /// or a control axis, that the sending centre's plan says would have to
    /// wait at a node: it is sent, and it is dropped where it would have
    /// waited, so it is likely to be lost. Absent otherwise.
    /// </summary>
    [SitrepUnit(Units.Text)]
    public string? Warning { get; set; }
}

/// <summary>
/// A request the mod could not carry out: a frame it could not read, an unknown
/// command, a command whose provider has stopped working, a result or payload
/// that could not be written, a subscription to a Topic nothing declares, or a
/// <c>set-vantage</c> naming a command centre that is not active. Nothing about
/// the game was decided, so there is no game reason to report.
///
/// <para>A command the game refused is not an error: it ran and said no, and
/// that arrives as a <c>command-response</c> whose result has
/// <c>success: false</c> and an <c>errorCode</c> from <c>CommandErrorCode</c>.
/// That vocabulary never appears here.</para>
///
/// <para><see cref="RequestId"/> is set when the error is about a command, and
/// <see cref="Topic"/> when it is about a subscription. <see cref="Code"/> is a
/// <c>FaultCode</c>, whose full list gives the sentence an operator reads for
/// each. A client's own transport adds its own members to the same field, and
/// the mod never sends those.</para>
/// </summary>
/// <category>Stream messages</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class ErrorMsg
{
    /// <summary>The frame type, always <c>"error"</c>.</summary>
#if SITREP_CODEGEN
    [TsProperty(Type = "\"error\"")]
#endif
    [SitrepUnit(Units.Id)]
    public string Type { get; set; } = "error";
    /// <summary>The id of the command request this error is about, or
    /// null.</summary>
    [SitrepUnit(Units.Id)]
    public string? RequestId { get; set; }
    /// <summary>The Topic this error is about, or null.</summary>
    [SitrepUnit(Units.Id)]
    public string? Topic { get; set; }
    /// <summary>Which fault: always a fault, never a refusal, since a command the game refused answers with a <c>command-response</c> instead.</summary>
#if SITREP_CODEGEN
    [TsProperty(Type = "FaultCode")]
#endif
    [SitrepUnit(Units.Id)]
    public FaultCode Code { get; set; } = FaultCode.Unclassified;

    /// <summary>The machinery's own account of what went wrong, for a log rather than an operator.</summary>
    [SitrepUnit(Units.Text)]
    public string Message { get; set; } = "";
}

/// <summary>
/// Asks the server to start sending a Topic to this connection.
/// </summary>
/// <category>Stream messages</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Subscribe
{
    /// <summary>The frame type, always <c>"subscribe"</c>.</summary>
#if SITREP_CODEGEN
    [TsProperty(Type = "\"subscribe\"")]
#endif
    [SitrepUnit(Units.Id)]
    public string Type { get; set; } = "subscribe";
    /// <summary>The Topic id to start receiving.</summary>
    [SitrepUnit(Units.Id)]
    public string Topic { get; set; } = "";
}

/// <summary>
/// Asks the server to stop sending a Topic to this connection.
/// </summary>
/// <category>Stream messages</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Unsubscribe
{
    /// <summary>The frame type, always <c>"unsubscribe"</c>.</summary>
#if SITREP_CODEGEN
    [TsProperty(Type = "\"unsubscribe\"")]
#endif
    [SitrepUnit(Units.Id)]
    public string Type { get; set; } = "unsubscribe";
    /// <summary>The Topic id to stop receiving.</summary>
    [SitrepUnit(Units.Id)]
    public string Topic { get; set; } = "";
}

/// <summary>
/// Client-to-server: select the command centre this connection commands from and
/// observes at. Governs both the downlink cursor read
/// and the command-dispatch vantage. The id must name a currently-active command
/// centre, or the request is refused with an <c>unknownVantage</c> error and the
/// connection keeps the vantage it had.
///
/// <para>A connection that has never sent one observes at the home command (the
/// roster entry whose <c>isHome</c> is true), and follows it if home moves. When
/// no home is identified it observes at the first ground station in ordinal id
/// order, and while no command centre is active at all (the main menu) at none,
/// stamping its frames with an empty <c>vantage</c>. Every frame's
/// <c>meta.vantage</c> says which of these is in force.</para>
/// </summary>
/// <category>Stream messages</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class SetVantage
{
    /// <summary>The frame type, always <c>"set-vantage"</c>.</summary>
#if SITREP_CODEGEN
    [TsProperty(Type = "\"set-vantage\"")]
#endif
    [SitrepUnit(Units.Id)]
    public string Type { get; set; } = "set-vantage";

    /// <summary>The command centre Id to adopt as this connection's
    /// vantage.</summary>
    [SitrepUnit(Units.Id)]
    public string CentreId { get; set; } = "";
}

/// <summary>
/// Server-to-client: the first frame on every connection, sent before
/// anything is asked for. <see cref="BootId"/> names the run of the mod the
/// connection has reached.
///
/// <para>A client that reconnects and reads the id it read before has reached
/// the same run: every <c>meta.timelineEpoch</c> it remembers still counts on
/// from where it was, and only the connection's own state has to be set up
/// again, which is each subscription and, where one was chosen, the vantage
/// (see <see cref="SetVantage"/>: a new connection starts at the home command
/// whatever the last one chose). A different id is another run, whose epochs
/// count from zero, so nothing remembered of the old one can be compared with
/// it.</para>
/// </summary>
/// <category>Stream messages</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Hello
{
    /// <summary>The frame type, always <c>"hello"</c>.</summary>
#if SITREP_CODEGEN
    [TsProperty(Type = "\"hello\"")]
#endif
    [SitrepUnit(Units.Id)]
    public string Type { get; set; } = "hello";

    /// <summary>
    /// An opaque id made afresh each time the mod starts its stream, the same
    /// on every connection until it next does. Compare it for equality only.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string BootId { get; set; } = "";
}

/// <summary>
/// Server-to-client: what the game is doing, sent on its own and not through
/// any topic. Sent straight after <see cref="Hello"/> on every connection that
/// has anything to learn, and again at every change.
///
/// <para>It is a frame of its own, and not a value on a topic, because a game
/// that is loading a scene has no clock that moves, and everything on a topic
/// is delivered by that clock. A topic could say a load had started only after
/// it had ended. It is also not delayed by light time at any command centre: a
/// load is a fact about the game on the machine, there is no game time to count
/// light time in while it runs, and nothing else reaches any centre during it
/// anyway.</para>
///
/// <para>While <see cref="State"/> is <c>"loading"</c> or
/// <c>"no-game"</c>, nothing the stream last said is current. Readings
/// received before the frame are still the latest there are, and none of them
/// is a live one. A <c>"ready"</c> that follows a load which started a
/// new timeline arrives after that timeline's <c>timeline-reset</c>.</para>
///
/// <para>A client that reads no <c>game-state</c> frame (an older client, or a
/// host that never sends one) is not wrong, only unaware: it drops a frame type
/// it does not know.</para>
/// </summary>
/// <category>Stream messages</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class GameState
{
    /// <summary>A scene is being loaded.</summary>
    public const string Loading = "loading";

    /// <summary>A scene stands and the game is running in it.</summary>
    public const string Ready = "ready";

    /// <summary>The main menu stands, so there is no game.</summary>
    public const string NoGame = "no-game";

    /// <summary>The frame type, always <c>"game-state"</c>.</summary>
#if SITREP_CODEGEN
    [TsProperty(Type = "\"game-state\"")]
#endif
    [SitrepUnit(Units.Id)]
    public string Type { get; set; } = "game-state";

    /// <summary>
    /// <c>"loading"</c>, <c>"ready"</c> or <c>"no-game"</c>. A client treats a
    /// value it does not know as <c>"ready"</c>.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string State { get; set; } = Ready;

    /// <summary>
    /// The scene being loaded while <see cref="State"/> is <c>"loading"</c>,
    /// otherwise the scene that stands: one of KSP's scene names, such as
    /// <c>"FLIGHT"</c>, <c>"SPACECENTER"</c>, <c>"TRACKSTATION"</c>,
    /// <c>"EDITOR"</c> or <c>"MAINMENU"</c>.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Scene { get; set; } = "";
}

/// <summary>
/// Client-to-server: asks for a <see cref="Pong"/>, to tell a connection that
/// is quiet from one that is dead. A subscribed connection can be silent for
/// as long as nothing it subscribed to changes, so silence alone says nothing;
/// a ping that goes unanswered does. It is answered at once and in every
/// scene, changes nothing, and needs no subscription.
/// </summary>
/// <category>Stream messages</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Ping
{
    /// <summary>The frame type, always <c>"ping"</c>.</summary>
#if SITREP_CODEGEN
    [TsProperty(Type = "\"ping\"")]
#endif
    [SitrepUnit(Units.Id)]
    public string Type { get; set; } = "ping";

    /// <summary>
    /// Anything the client likes, returned unchanged in the answering
    /// <see cref="Pong"/> so it can tell which ping was answered. May be
    /// omitted, in which case the answer carries an empty one.
    /// </summary>
    [SitrepUnit(Units.Id)]
    public string Nonce { get; set; } = "";
}

/// <summary>Server-to-client: the answer to a <see cref="Ping"/>.</summary>
/// <category>Stream messages</category>
[SitrepContract]
#if SITREP_CODEGEN
[TsInterface]
#endif
public class Pong
{
    /// <summary>The frame type, always <c>"pong"</c>.</summary>
#if SITREP_CODEGEN
    [TsProperty(Type = "\"pong\"")]
#endif
    [SitrepUnit(Units.Id)]
    public string Type { get; set; } = "pong";

    /// <summary>The <see cref="Ping.Nonce"/> of the ping this answers.</summary>
    [SitrepUnit(Units.Id)]
    public string Nonce { get; set; } = "";
}
