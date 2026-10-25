#!/usr/bin/env node
/**
 * A TURN server small enough to run anywhere, standing in for the `turnserver`
 * binary the relay spawns. It speaks the part of RFC 5766 a browser's
 * data-channel connection uses over UDP and TCP (Allocate, Refresh,
 * CreatePermission, ChannelBind, Send/Data indications, ChannelData), takes
 * coturn's own command-line flags, and holds one relay port per allocation from
 * `--min-port`..`--max-port` the way coturn does, answering 486 once
 * `--total-quota` allocations exist and expiring an allocation that is not
 * refreshed within `--max-allocate-lifetime` seconds.
 *
 * `--denied-peer-ip=<lo>-<hi>` and `--allowed-peer-ip=<ip>` (repeatable, an
 * allowed address wins) refuse a CreatePermission or ChannelBind toward a
 * matching peer with 403, and drop a Send toward one, as coturn does. Data is
 * relayed in either direction only for a peer address that holds a permission.
 *
 * Every allocation event is written to stdout as one line, so a test or a
 * measurement reads what holds each port:
 *   ALLOC <transport> <client> relay=<port> live=<n>
 *   FREE <transport> <client> relay=<port> why=<refresh0|expired|closed> live=<n>
 *   REFUSED <transport> <client> why=<quota|ports>
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import dgram from "node:dgram";
import { appendFileSync } from "node:fs";
import net from "node:net";

const flags = new Map();
for (const arg of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
  if (m) flags.set(m[1], m[2] ?? "true");
}
const PORT = Number(flags.get("listening-port") ?? 3478);
const MIN = Number(flags.get("min-port") ?? 49152);
const MAX = Number(flags.get("max-port") ?? 65535);
const QUOTA = Number(flags.get("total-quota") ?? Number.POSITIVE_INFINITY);
const MAX_LIFETIME = Number(flags.get("max-allocate-lifetime") ?? 600);
const REALM = flags.get("realm") ?? "gonogo";
const [USER, PASS] = (flags.get("user") ?? "gonogo:secret").split(/:(.*)/s);
const ADVERTISE = (flags.get("external-ip") ?? "127.0.0.1").split("/")[0];
const BIND = "0.0.0.0";

const ipValue = (ip) =>
  ip.split(".").reduce((n, octet) => n * 256 + Number(octet), 0);
const ranges = (name) =>
  process.argv
    .filter((arg) => arg.startsWith(`--${name}=`))
    .map((arg) => arg.slice(name.length + 3).split("-"))
    .filter(([lo]) => /^\d+\.\d+\.\d+\.\d+$/.test(lo))
    .map(([lo, hi]) => [ipValue(lo), ipValue(hi ?? lo)]);
const DENIED = ranges("denied-peer-ip");
const ALLOWED = ranges("allowed-peer-ip");
const inside = (list, ip) => {
  const v = ipValue(ip);
  return list.some(([lo, hi]) => v >= lo && v <= hi);
};
const peerAllowed = (ip) => inside(ALLOWED, ip) || !inside(DENIED, ip);

const MAGIC = 0x2112a442;
const T = {
  ALLOCATE: 0x0003,
  REFRESH: 0x0004,
  SEND: 0x0016,
  DATA: 0x0017,
  PERMISSION: 0x0008,
  CHANNEL_BIND: 0x0009,
};
const A = {
  USERNAME: 0x0006,
  INTEGRITY: 0x0008,
  ERROR: 0x0009,
  CHANNEL: 0x000c,
  LIFETIME: 0x000d,
  PEER: 0x0012,
  DATA: 0x0013,
  REALM: 0x0014,
  NONCE: 0x0015,
  RELAYED: 0x0016,
  TRANSPORT: 0x0019,
  XOR_MAPPED: 0x0020,
};

const logFile = process.env.FAKE_TURN_LOG;
const log = (line) => {
  process.stdout.write(`${line}\n`);
  if (logFile) appendFileSync(logFile, `${Date.now()} ${line}\n`);
};
const key = createHash("md5").update(`${USER}:${REALM}:${PASS}`).digest();
const nonce = randomBytes(8).toString("hex");

/** @type {Map<string, Allocation>} */
const allocations = new Map();
const usedPorts = new Set();

function parse(buf) {
  if (buf.length < 20 || buf.readUInt32BE(4) !== MAGIC) return null;
  const type = buf.readUInt16BE(0);
  const len = buf.readUInt16BE(2);
  const txid = buf.subarray(8, 20);
  const attrs = new Map();
  let off = 20;
  while (off + 4 <= 20 + len) {
    const at = buf.readUInt16BE(off);
    const al = buf.readUInt16BE(off + 2);
    attrs.set(at, buf.subarray(off + 4, off + 4 + al));
    off += 4 + al + ((4 - (al % 4)) % 4);
  }
  return { type, txid, attrs };
}

function attr(type, value) {
  const pad = (4 - (value.length % 4)) % 4;
  const head = Buffer.alloc(4);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(value.length, 2);
  return Buffer.concat([head, value, Buffer.alloc(pad)]);
}

function message(type, txid, attrs, signed = false) {
  let body = Buffer.concat(attrs);
  if (signed) {
    const head = Buffer.alloc(20);
    head.writeUInt16BE(type, 0);
    head.writeUInt16BE(body.length + 24, 2);
    head.writeUInt32BE(MAGIC, 4);
    txid.copy(head, 8);
    const mac = createHmac("sha1", key)
      .update(Buffer.concat([head, body]))
      .digest();
    body = Buffer.concat([body, attr(A.INTEGRITY, mac)]);
  }
  const head = Buffer.alloc(20);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(body.length, 2);
  head.writeUInt32BE(MAGIC, 4);
  txid.copy(head, 8);
  return Buffer.concat([head, body]);
}

function xorAddr(ip, port, txid) {
  const v = Buffer.alloc(8);
  v.writeUInt8(1, 1);
  v.writeUInt16BE(port ^ (MAGIC >>> 16), 2);
  const octets = ip.split(".").map(Number);
  const m = Buffer.alloc(4);
  m.writeUInt32BE(MAGIC, 0);
  for (let i = 0; i < 4; i++) v[4 + i] = octets[i] ^ m[i];
  void txid;
  return v;
}

function unxorAddr(v) {
  const port = v.readUInt16BE(2) ^ (MAGIC >>> 16);
  const m = Buffer.alloc(4);
  m.writeUInt32BE(MAGIC, 0);
  const ip = [0, 1, 2, 3].map((i) => v[4 + i] ^ m[i]).join(".");
  return { ip, port };
}

function errorAttr(code, text) {
  const v = Buffer.alloc(4);
  v.writeUInt8(Math.floor(code / 100), 2);
  v.writeUInt8(code % 100, 3);
  return attr(A.ERROR, Buffer.concat([v, Buffer.from(text)]));
}

function lifetimeAttr(s) {
  const v = Buffer.alloc(4);
  v.writeUInt32BE(s, 0);
  return attr(A.LIFETIME, v);
}

function pickPort() {
  for (let p = MIN; p <= MAX; p++) if (!usedPorts.has(p)) return p;
  return null;
}

function free(a, why) {
  if (!allocations.delete(a.id)) return;
  clearTimeout(a.timer);
  usedPorts.delete(a.port);
  a.sock.close();
  log(
    `FREE ${a.transport} ${a.client} relay=${a.port} why=${why} live=${allocations.size}`,
  );
}

function arm(a, seconds) {
  clearTimeout(a.timer);
  a.timer = setTimeout(
    () => free(a, "expired"),
    Math.min(seconds, MAX_LIFETIME) * 1000,
  );
}

/**
 * @param {{transport:'udp'|'tcp', client:string, send:(b:Buffer)=>void}} conn
 */
function handle(conn, buf) {
  if (buf.length >= 4 && (buf[0] & 0xc0) === 0x40) {
    const a = allocations.get(conn.client);
    if (!a) return;
    const ch = buf.readUInt16BE(0);
    const len = buf.readUInt16BE(2);
    const peer = a.channels.get(ch);
    if (peer && a.permitted.has(peer.ip))
      a.sock.send(buf.subarray(4, 4 + len), peer.port, peer.ip);
    return;
  }
  const msg = parse(buf);
  if (!msg) return;
  const alloc = allocations.get(conn.client);

  if (msg.type === T.SEND) {
    const peerV = msg.attrs.get(A.PEER);
    const data = msg.attrs.get(A.DATA);
    if (alloc && peerV && data) {
      const p = unxorAddr(peerV);
      if (alloc.permitted.has(p.ip)) alloc.sock.send(data, p.port, p.ip);
    }
    return;
  }

  const method = msg.type & 0x3eef;
  if (process.env.FAKE_TURN_DEBUG)
    log(`REQ 0x${method.toString(16)} ${conn.transport} ${conn.client}`);
  const reply = (cls, attrs) =>
    conn.send(message(method | cls, msg.txid, attrs));
  const fail = (code, text, extra = []) =>
    reply(0x0110, [errorAttr(code, text), ...extra]);
  const ok = (attrs) =>
    conn.send(message(method | 0x0100, msg.txid, attrs, true));

  if (!msg.attrs.has(A.INTEGRITY)) {
    fail(401, "Unauthorized", [
      attr(A.REALM, Buffer.from(REALM)),
      attr(A.NONCE, Buffer.from(nonce)),
    ]);
    return;
  }
  if (msg.attrs.get(A.USERNAME)?.toString() !== USER) {
    fail(401, "Unauthorized", [
      attr(A.REALM, Buffer.from(REALM)),
      attr(A.NONCE, Buffer.from(nonce)),
    ]);
    return;
  }

  if (method === T.ALLOCATE) {
    if (alloc) {
      fail(437, "Allocation Mismatch");
      return;
    }
    if (allocations.size >= QUOTA) {
      log(`REFUSED ${conn.transport} ${conn.client} why=quota`);
      fail(486, "Allocation Quota Reached");
      return;
    }
    const port = pickPort();
    if (port === null) {
      log(`REFUSED ${conn.transport} ${conn.client} why=ports`);
      fail(508, "Insufficient Capacity");
      return;
    }
    const sock = dgram.createSocket("udp4");
    const a = {
      id: conn.client,
      transport: conn.transport,
      client: conn.client,
      port,
      sock,
      timer: undefined,
      channels: new Map(),
      permitted: new Set(),
      send: conn.send,
    };
    sock.on("error", () => {});
    sock.bind(port, BIND);
    sock.on("message", (data, rinfo) => {
      if (!a.permitted.has(rinfo.address)) return;
      const ch = [...a.channels].find(
        ([, p]) => p.ip === rinfo.address && p.port === rinfo.port,
      );
      if (ch) {
        const head = Buffer.alloc(4);
        head.writeUInt16BE(ch[0], 0);
        head.writeUInt16BE(data.length, 2);
        a.send(
          Buffer.concat([
            head,
            data,
            Buffer.alloc((4 - (data.length % 4)) % 4),
          ]),
        );
        return;
      }
      a.send(
        message(0x0017, randomBytes(12), [
          attr(A.PEER, xorAddr(rinfo.address, rinfo.port)),
          attr(A.DATA, data),
        ]),
      );
    });
    allocations.set(conn.client, a);
    usedPorts.add(port);
    arm(a, 600);
    log(
      `ALLOC ${conn.transport} ${conn.client} relay=${port} live=${allocations.size}`,
    );
    const [cip, cport] = conn.client.split(":");
    ok([
      attr(A.RELAYED, xorAddr(ADVERTISE, port)),
      attr(A.XOR_MAPPED, xorAddr(cip, Number(cport))),
      lifetimeAttr(Math.min(600, MAX_LIFETIME)),
    ]);
    return;
  }

  if (!alloc) {
    fail(437, "Allocation Mismatch");
    return;
  }
  if (method === T.REFRESH) {
    const life = msg.attrs.get(A.LIFETIME)?.readUInt32BE(0) ?? 600;
    if (life === 0) {
      ok([lifetimeAttr(0)]);
      free(alloc, "refresh0");
      return;
    }
    arm(alloc, life);
    ok([lifetimeAttr(Math.min(life, MAX_LIFETIME))]);
    return;
  }
  if (method === T.PERMISSION) {
    const peerV = msg.attrs.get(A.PEER);
    const peer = peerV ? unxorAddr(peerV) : null;
    if (peer && !peerAllowed(peer.ip)) {
      log(`DENIED ${conn.transport} ${conn.client} permission peer=${peer.ip}`);
      fail(403, "Forbidden IP");
      return;
    }
    if (peer) alloc.permitted.add(peer.ip);
    ok([]);
    return;
  }
  if (method === T.CHANNEL_BIND) {
    const ch = msg.attrs.get(A.CHANNEL)?.readUInt16BE(0);
    const peerV = msg.attrs.get(A.PEER);
    const peer = peerV ? unxorAddr(peerV) : null;
    if (peer && !peerAllowed(peer.ip)) {
      log(`DENIED ${conn.transport} ${conn.client} channel peer=${peer.ip}`);
      fail(403, "Forbidden IP");
      return;
    }
    if (ch !== undefined && peer) {
      alloc.channels.set(ch, peer);
      alloc.permitted.add(peer.ip);
    }
    ok([]);
    return;
  }
  fail(400, "Bad Request");
}

const udp = dgram.createSocket("udp4");
udp.on("message", (buf, rinfo) => {
  const client = `${rinfo.address}:${rinfo.port}`;
  handle(
    {
      transport: "udp",
      client,
      send: (b) => udp.send(b, rinfo.port, rinfo.address),
    },
    buf,
  );
});
udp.bind(PORT, BIND);

net
  .createServer((s) => {
    const client = `${s.remoteAddress?.replace("::ffff:", "")}:${s.remotePort}`;
    let pending = Buffer.alloc(0);
    s.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      for (;;) {
        if (pending.length < 4) return;
        const isChannel = (pending[0] & 0xc0) === 0x40;
        const total = isChannel
          ? 4 + pending.readUInt16BE(2)
          : 20 + pending.readUInt16BE(2);
        const padded = isChannel ? total + ((4 - (total % 4)) % 4) : total;
        if (pending.length < padded) return;
        const one = pending.subarray(0, total);
        pending = pending.subarray(padded);
        handle({ transport: "tcp", client, send: (b) => s.write(b) }, one);
      }
    });
    s.on("error", () => {});
    s.on("close", () => {
      const a = allocations.get(client);
      if (a) free(a, "closed");
    });
  })
  .listen(PORT, BIND);

log(
  `READY port=${PORT} relay=${MIN}-${MAX} quota=${QUOTA} lifetime=${MAX_LIFETIME}`,
);
