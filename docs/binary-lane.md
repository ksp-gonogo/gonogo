# The binary lane

Most of what the Gonogo mod sends over its WebSocket is JSON. The binary lane is
for the exception: a channel whose payload is opaque bytes, where wrapping every
byte in a JSON number array would cost about seven times what the bytes cost.

Audio is the case it was built for. Nothing about the lane is specific to audio,
or to any codec: the mod carries byte segments and does not look inside them.

This page is the wire format. You can decode it with anything that opens a
WebSocket, in any language, with no Gonogo package installed. That is deliberate:
tuning in should not require an SDK.

## The layout

```
offset  size            field
0       1               MAGIC, always 0x9E
1       1               LANE, 0x01 = stream-binary
2       2               header length H, unsigned 16-bit, big-endian
4       H               the header, UTF-8 JSON
4+H     sum(segments)   the segments, concatenated, in order
```

The header is an ordinary JSON document:

```json
{
  "type": "stream-binary",
  "topic": "radio.rx.vessel-3f2a",
  "segments": [87, 91, 88, 90, 87],
  "meta": {
    "source": "radio",
    "validAt": 41823.5,
    "seq": 1204,
    "deliveredAt": 41853.5,
    "vantage": "ksc",
    "quality": 1,
    "active": true,
    "staleness": 0,
    "timelineEpoch": 3
  }
}
```

`segments` is a table of byte lengths. The bytes that follow the header are those
segments end to end, in that order: the first 87 bytes are segment 0, the next 91
are segment 1, and so on. There is no delimiter and no padding between them, so
a segment may contain any byte at all, `0x9E` and `{` included.

`meta` is the same `Meta` a `stream-data` frame carries, unchanged. A binary
delivery goes through the same reveal gate as everything else, so `validAt` is
when it was true and `deliveredAt` is when your vantage was allowed to hear it.

## Telling the two lanes apart

Both lanes arrive as WebSocket **binary** frames. That is not new: the mod has
always written its JSON as binary, so the frame's own type tells you nothing.

Read the first byte:

- `0x7B` (`{`): a JSON frame, exactly as before. UTF-8 decode it and parse
- `0x9E`: a binary-lane frame, laid out as above
- anything else: refuse it, and say so

`0x9E` cannot collide with a JSON frame for two independent reasons. Every
document the protocol writes opens with `{`, and `0x80`-`0xBF` is the UTF-8
continuation range, which can never legally lead a UTF-8 document at all.

## Reading one

```js
const socket = new WebSocket("ws://<ksp-host>:8090");
socket.binaryType = "arraybuffer";

socket.addEventListener("message", (event) => {
  if (typeof event.data === "string") return handleJson(event.data);

  const bytes = new Uint8Array(event.data);
  if (bytes[0] !== 0x9e) return handleJson(new TextDecoder().decode(bytes));
  if (bytes[1] !== 0x01) throw new Error(`unknown binary lane ${bytes[1]}`);

  const headerLength = (bytes[2] << 8) | bytes[3];
  const header = JSON.parse(
    new TextDecoder().decode(bytes.subarray(4, 4 + headerLength)),
  );

  let cursor = 4 + headerLength;
  const segments = header.segments.map((length) => {
    const segment = bytes.subarray(cursor, cursor + length);
    cursor += length;
    return segment;
  });

  handleBinary(header.topic, header.meta, segments);
});
```

Using the SDK, that whole block is `decodeBinaryFrame(bytes)` from
`@ksp-gonogo/sitrep-sdk`, and an Uplink reading its own opaque channel through
`useTelemetry` gets the segments without touching any of it.

## Rules a decoder has to follow

**Trust the table, never scan for a delimiter.** There isn't one. A segment full
of `0x9E` bytes is a perfectly ordinary segment.

**A frame that does not add up is unread.** The segment lengths must sum to
*exactly* the bytes remaining after the header. Short means the frame was
truncated; long means the sender's header and buffer disagree. In both cases
drop the whole frame and say why. Do not deliver the segments that happen to
line up: a listener handed a fragment has no way to know it is one.

**Zero segments is a real delivery, not an error.** It means the producer had
nothing to send this tick. That is why a broken frame must never be reported as
an empty one; the two would be indistinguishable.

**An unknown lane byte is refused by name.** Never fall back to treating the
bytes as text. UTF-8 decoding compressed audio produces replacement characters
that then fail JSON parsing somewhere else entirely, and the one useful fact,
that your decoder is older than the mod, is gone by then.

## Why one frame carries many segments

The envelope is what costs, not the payload. A 20 ms audio chunk is about 87
bytes and the header around it is roughly 300, so a producer sending one chunk
per frame pays the header fifty times a second and spends four times more on
description than on content. There is a second, larger cost inside the mod: each
delivery is scheduled on the light-time clock, and that clock is ticked once per
in-game second, so the schedule grows with the number of in-flight deliveries
rather than with their size.

Batching ten chunks behind one header fixes both. Measured on the real
assemblies: three people talking, heard by three screens, costs 381 ms of
main-thread time per tick unbatched and 4 ms batched.

So the lane is built around the batch. If you are producing on it, send 100-200
ms of content per frame rather than one unit per frame.

## Directions

The lane runs **server to client only**. A client that sends a binary frame up
the socket is refused with an `error` frame carrying the code
`binary-frame-not-accepted`, rather than having its bytes silently UTF-8 decoded
and reported as a malformed envelope.

Bytes travelling the other way go as a command's arguments, which is also what
gets them the uplink delay applied the same way every other command gets it.

## Publishing on it, from an Uplink

Set one flag on the channel declaration, next to `Delivery` and `Delay`:

```csharp
new ChannelDeclaration
{
    Topic = "radio.rx.vessel-3f2a",
    Delivery = Delivery.ReliableOrdered,
    Delay = DelayRole.Delayed,
    OpaquePayload = true,
    Emission = new EmissionPolicy(keyframeIntervalUt: 0, quantum: EmissionQuantum.Absolute(0)),
}
```

Your mapper then returns either a `byte[]` (one segment) or an ordered
collection of them (the batch, and the one to prefer).

Nothing infers the lane from your payload's type, and nothing reads your topic
name. Publishing a `byte[]` as a JSON number array is a legitimate thing for a
channel to do, so the lane is opt-in or it does not happen.

Two things to get right:

- **Stamp each batch with live UT at capture**, not with the engine tick's UT.
  On a `LossyLatest` channel, samples sharing one `validAt` collapse to the last
  one, so a whole second of content stamped from the tick becomes one frame
- **A null mapper result is refused**, and named on the host log and to the
  subscriber. Zero segments already means "nothing this tick"; if you want a
  real absence tombstone you want the JSON envelope, not this lane

## Where the format lives

- `mod/Sitrep.Contract/BinaryLane.cs`: the constants and the reasoning
- `mod/Sitrep.Core/Serialization/BinaryFrameCodec.cs`: the writer
- `mod/sitrep-sdk/src/binary-frame.ts`: the reader
- `mod/golden-fixtures/binary-frame.json`: real frames from the writer, decoded
  by both ends' tests, so the two cannot drift apart quietly
