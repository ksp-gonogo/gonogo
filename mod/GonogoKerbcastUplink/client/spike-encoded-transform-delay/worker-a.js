// Encoded-transform delay worker (harness A).
//
// Registers self.onrtctransform for the modern WebRTC Encoded Transform API
// (RTCRtpScriptTransform). Holds every encoded video frame it receives for
// `delayMs` (default 4000) and then writes it back into the pipeline
// FIFO-in-order, unmodified. Reports queue-depth / byte-size stats back to
// the main thread via postMessage so the harness can log peak buffered
// bytes for the encoded-domain memory measurement.

let peakBufferedBytes = 0;
let peakQueueLength = 0;
let framesIn = 0;
let framesOut = 0;
let writeErrors = 0;

function reportStats() {
  postMessage({
    kind: "stats",
    peakBufferedBytes,
    peakQueueLength,
    framesIn,
    framesOut,
    writeErrors,
  });
}

function attach(readable, writable, options) {
  const delayMs = options?.delayMs ?? 4000;
  const reader = readable.getReader();
  const writer = writable.getWriter();
  /** @type {{frame: any, releaseAt: number, bytes: number}[]} */
  const queue = [];
  let timer = null;

  function scheduleNext() {
    if (timer !== null) return;
    if (queue.length === 0) return;
    const head = queue[0];
    const wait = Math.max(0, head.releaseAt - performance.now());
    timer = setTimeout(() => {
      timer = null;
      drain();
    }, wait);
  }

  function drain() {
    const now = performance.now();
    while (queue.length > 0 && queue[0].releaseAt <= now) {
      const item = queue.shift();
      writer
        .write(item.frame)
        .then(() => {
          framesOut++;
        })
        .catch((err) => {
          writeErrors++;
          postMessage({
            kind: "error",
            where: "writer.write",
            message: String(err),
          });
        });
    }
    scheduleNext();
  }

  let describedFrameShape = false;

  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        framesIn++;
        if (!describedFrameShape) {
          describedFrameShape = true;
          let metadata = null;
          try {
            metadata =
              typeof value.getMetadata === "function"
                ? value.getMetadata()
                : null;
          } catch (e) {
            metadata = { error: String(e) };
          }
          postMessage({
            kind: "frame-shape",
            hasTimestamp: typeof value.timestamp,
            timestampValue: value.timestamp,
            type: value.type,
            hasGetMetadata: typeof value.getMetadata === "function",
            metadata,
            constructorName: value.constructor?.name,
          });
        }
        const bytes = value.data?.byteLength ?? 0;
        queue.push({
          frame: value,
          releaseAt: performance.now() + delayMs,
          bytes,
        });

        let bufferedBytes = 0;
        for (const q of queue) bufferedBytes += q.bytes;
        if (bufferedBytes > peakBufferedBytes)
          peakBufferedBytes = bufferedBytes;
        if (queue.length > peakQueueLength) peakQueueLength = queue.length;

        scheduleNext();
        if (framesIn % 10 === 0) reportStats();
      }
    } catch (err) {
      postMessage({
        kind: "error",
        where: "reader.read",
        message: String(err),
      });
    }
  })();
}

// Modern API: RTCRtpScriptTransform posts an "rtctransform" event carrying
// an RTCTransformEvent whose .transformer exposes .readable/.writable/.options.
self.onrtctransform = (event) => {
  postMessage({ kind: "onrtctransform-fired" });
  const transformer = event.transformer;
  attach(transformer.readable, transformer.writable, transformer.options);
};

// Legacy fallback: some Chrome builds only exposed the "insertable streams"
// generic transform shape (encodedInsertableStreams + createEncodedStreams()
// on the receiver, with the streams themselves posted into the worker via
// postMessage from the main thread instead of self.onrtctransform).
self.onmessage = (event) => {
  const msg = event.data;
  if (msg?.kind === "attach-legacy") {
    attach(msg.readable, msg.writable, msg.options);
  } else if (msg?.kind === "get-stats") {
    reportStats();
  }
};

postMessage({ kind: "worker-ready" });
