# The kerbcast Uplink — design + build report

Base: `631d01e6` (staging).

Supersedes the conclusion of `.superpowers/sdd/u4-kerbcast-report.md`, which
found that kerbcast "is not an Uplink" and built the delay-authority seam
instead. That report's *findings* are good and its code is load-bearing and
untouched here (see §8). Its *conclusion* is rejected: kerbcast has an Uplink.

---

## 1. The insight that makes this work

The previous attempt stalled on a real constraint: **kerbcast's video rides
WebRTC direct to the browser, not the Sitrep stream.** That is true, and it is
not going to change — a UT-indexed, keyframed telemetry channel is the wrong
shape for a 30fps H.264 stream, and the WebRTC path already works.

But "the video can't be a Topic" was treated as "kerbcast can't be an Uplink".
That does not follow. kerbcast splits cleanly in two:

| plane | what | transport | owner |
|---|---|---|---|
| **media** | H.264 frames | WebRTC (sidecar → browser) | kerbcast's own SDK, unchanged |
| **control** | what cameras exist, what can they do, which are docking cameras, is it healthy, point that camera there | **Sitrep Topics + commands** | **the Uplink** |

The control plane is ordinary telemetry. It must obey signal delay, must report
health through `system.uplinks`, and must be readable by a station screen that
never talks to the sidecar. That is an Uplink's job description.

**Media stays on WebRTC. The Uplink does not carry video.**

---

## 2. Licence — this decides the architecture

**kerbcast is CC-BY-NC-SA-4.0** (`~/personal/kerbcam/LICENSE`) — a content
licence carrying **both** NonCommercial and ShareAlike terms. gonogo is MIT
(with `Gonogo.Kos` as the sole GPL island).

So the two prior-art patterns are **not** interchangeable here:

- `GonogoScansatUplink` takes a `Private="false"` compile-time reference to
  `SCANsat.dll`. **Not available to us** — ShareAlike could reach a combined
  work.
- `GonogoRealAntennasUplink` never links RA's CC-BY-SA-4.0 assembly and reaches
  every member by runtime reflection. **This is the mandatory pattern**, and the
  precedent already exists in-repo for exactly this reason.

`KerbcastReflection.cs` is therefore the **licence boundary, not an
implementation detail**. `NOTICE-KERBCAST.txt` says so explicitly, because the
single most likely future regression is someone "simplifying" the project by
adding a `<Reference Include="Kerbcast">`.

The reflection target is `Kerbcast.KerbcastControl` — a public **static** facade
kerbcast already maintains as its in-process integration seam (it is what
kerbcast's own kOS add-on calls). We are using a published API, not prying open
an internal.

---

## 3. What the Uplink owns

### Topics

| topic | payload | delivery | delay | why |
|---|---|---|---|---|
| `kerbcast.available` | bare `boolean` | LossyLatest | **TrueNow** | Ground-side fact about the *install*, not the craft. The presence gate an augment declares `requires: "kerbcast"` against. Bare bool ⇒ **no contract POCO** (a `{available}` wrapper would misrepresent the wire), hand-declared in `topics.ts` exactly like `scansat.available`. |
| `kerbcast.cameras` | `KerbcastCameraEntry[]` | LossyLatest | **Delayed** | The camera inventory is an *observation of hardware on the craft*, learned over the comms link. |

`kerbcast.cameras` being **Delayed** is deliberate and load-bearing: the WebRTC
video is played out through the same delay authority (`useViewClock`), so the
camera list and the picture it describes reveal **together**. A TrueNow list
would race ahead of its own image.

### Commands

| command | args | delayed |
|---|---|---|
| `kerbcast.setFieldOfView` | `{cameraId, fieldOfView}` | yes |
| `kerbcast.setPan` | `{cameraId, yaw, pitch}` | yes |

Both Delayed: aiming or zooming is an instruction to hardware on the craft, so
it rides the signal-delay Courier like staging or SAS.

### Naming

Clean full names per the project rule — `fieldOfView` not kerbcast's `fov`,
`panYawMinimum` not `panYawMin`. The contract is gonogo's vocabulary, not a
passthrough of the upstream mod's abbreviations. Pinned by a test.

### Identity — `cameraId` vs `partId`, kept separate

kerbcast's `flightId` is **not reliably a KSP part id**: it is `part.flightID`
for module 0 but a **synthetic hash** for the 2nd+ camera module on a
multi-camera part. So the contract carries both:

- `cameraId` — kerbcast's handle. What commands and the WebRTC `subscribe` take.
- `partId` — the real `Part.flightID`. The join key onto `vessel.parts`.

Conflating them would silently break that join. Pinned by a test.

---

## 4. Health — the mandatory healthcheck

This is the reason the Uplink exists.

Commit `45111e44` deleted `KerbcastHealthRow` because it read
`KerbcastDataSource.status` — a **client-side** view of a **separate** WebRTC
connection, bypassing the mod contract. The commit was right: "the Uplinks list
is contract-only". An Uplink gets a healthcheck; a bolted-on DataSource does
not.

`KerbcastUplink` implements `IUplinkHealthReporter` — **the first real
implementation in the repo**. Everything downstream already exists:

`ChannelEngine.BuildUplinkHealthPayload` → `system.uplinks` (already carries
`{id, version, available, reason, health}`) → already in
`default-carried-topics` → `deriveSystemUplinkHealth` → `UplinkHealthList` in
`SettingsModal`.

**So the health row returns with ZERO client changes.** That is precisely what
"the Uplinks list is contract-only" buys, and it is why this is worth doing
properly rather than re-adding a bypass row.

### The states are deliberately distinguishable

| state | detail | the operator's actual problem |
|---|---|---|
| Unavailable | "kerbcast mod not installed" | **install** problem |
| Degraded | "capture core is not running (no flight scene)" | **scene** problem — you're in the VAB |
| Degraded | "the active vessel carries no camera parts" | **craft** problem — no camera on it |
| Healthy | "3 cameras" | fine |

A black feed cannot tell those three apart. This can. `KerbcastHealth.Evaluate`
is extracted as a **pure function** so the state machine is tested headless
rather than being live-only code.

### Thread safety

`Health()` is polled on the **Courier thread** every `system.uplinks` sample and
must be cheap and non-blocking. It reads only cached `volatile` fields written
by the main-thread capture — it never touches a Unity object off-thread (a Unity
null-check off-thread is not safe).

### One deliberate deviation from precedent

`Register` uses the **ungated** `AddSampledSource` overload. Scansat and RA use
the subscription-gated one, but gating would make the camera count stale (or
absent) whenever no camera widget is on the dashboard. **A mandatory healthcheck
must answer when nothing is watching.** The capture stays cheap: a handful of
cameras, a short module scan each.

---

## 5. Docking cameras — how they're identified

**kerbcast cannot answer this.** Grepping the whole repo: zero references to
`ModuleDockingNode`, nothing on its wire, no attach-node/anchor data. Its only
nod to docking is a Hullcam *visual filter mode* called "DockingCam" — a reticle
overlay, not a fact about the craft, and not on the wire either.

Today the only available guess is **sniffing `partTitle` for "Docking"** or
matching `cameraName == "NavCam"` — which is what kerbcast's own client-side
labeller resorts to. That guess is wrong in both directions:

- false-**positives** on any part titled "Docking Bay Floodlight"
- false-**negatives** on every modded port without "Docking" in its title
- can't distinguish a mated port from a free one

**The Uplink can do better for free.** kerbcast's control facade already hands
out the owning stock KSP `Part` on every camera view (`KerbcastCameraView.Part`).
A `Part` is **stock KSP** — gonogo references `Assembly-CSharp` freely, no
licence entanglement. So `DockingCameraDetector` reads the part's own
`ModuleDockingNode` and answers from the craft's actual module list:

```
isDockingCamera      ← the camera's own part carries a ModuleDockingNode
dockingPortNodeType  ← node.nodeType   (size1/size2 — what it can mate with)
dockingPortState     ← node.state      (Ready/Docked/Acquire)
```

Ground truth, not a string guess, and **zero changes to kerbcast**.

### The definition, stated precisely

A docking camera is a camera **whose own part carries a `ModuleDockingNode`**. A
camera merely mounted *near* a port is **not** reported as one — proximity would
be a heuristic with an invented radius, and this contract does not fabricate
confidence it doesn't have. In practice the stock docking-port cameras satisfy
the strict definition, because Hullcam's patch adds the camera module to the
port part itself.

### Typed absence

`isDockingCamera` is **nullable**, and the distinction is real:

- `true` — read the part, it has a docking node
- `false` — read the part, it has **no** docking node
- `null` — **could not read the part**; we don't know

`null` ≠ `false`. Pinned by a test.

---

## 6. Versioning

`ContractVersion` Minor **0 → 1** (Major stays 4).

Three brand-new `[SitrepContract]` types, no existing type touched ⇒ additive ⇒
Minor. Confirmed, not asserted: `ContractShapeGateTests` (the CI "lying minor"
gate) passes — it fails on a non-additive change unless Major moves. Provenance
recorded in the `Minor` doc-comment per convention.

The `Major`/`Minor` mechanism is genuinely clever and was left alone: they are
bare `const int`s so the C# compiler **inlines them into the caller's attribute
blob at compile time**. `[SitrepUplink("kerbcast")]` therefore permanently
records "built against 4.1" even after core moves on. A Major mismatch fail-softs
the Uplink without calling `Register`; a Minor mismatch either way is fine
(additive-only ⇒ always a shared subset).

Codegen re-run via `bash mod/codegen.sh`. No generated file hand-edited.

---

## 7. What landed

**Contract** (`mod/Sitrep.Contract/`)
- `KerbcastPayloads.cs` — `KerbcastCameraEntry`, `KerbcastSetFieldOfViewArgs`, `KerbcastSetPanArgs`
- `ContractVersion.cs` — Minor 0 → 1 + provenance
- `RtConfig.cs` — the three types registered for codegen
- regenerated `contract.ts` + `topic-map.ts`

**The Uplink** (`mod/GonogoKerbcastUplink/`)
- `GonogoKerbcastUplink.csproj` — MIT, net48, **no kerbcast reference** (licence header)
- `KerbcastReflection.cs` — the arm's-length surface (+ `ForAssembly` test seam)
- `DockingCameraDetector.cs` / `DockingCameraFacts.cs` — the docking derivation
- `KerbcastCameraEntryBuilder.cs` — the clean-name wire mapping
- `KerbcastHealth.cs` — the healthcheck state machine (pure)
- `KerbcastUplink.cs` — `ISitrepUplink` + `IUplinkHealthReporter`
- `NOTICE-KERBCAST.txt`, `GonogoKerbcastUplink.netkan`

**Tests** (`mod/GonogoKerbcastUplink.Tests/`) — 26 tests, KSP-free selective-Compile
split (the same pattern the Scansat/RA test projects use). Stand-ins for
kerbcast's seam are independently-written shape-compatible doubles, not copies.

**SDK / client**
- `topics.ts` — `KerbcastTopicPayloadMap` (bare-bool `kerbcast.available`)
- `topics.test.ts` — hand-declared roster updated (this guard caught the drift)
- `default-carried-topics.ts` — both kerbcast topics promoted

**Architectural ratchets** (`packages/core/`) — both fired, both were right:
- `uplink-boundary.test.ts` — `MOD_OWNERSHIP.kerbcast.ownedDirs` extended to the
  new Uplink dirs. Its old comment literally read *"No GonogoKerbcastUplink
  exists yet"*; that premise is what this work changes. Contract/SDK-layer
  references allowlisted as GRAY with justification, matching the existing
  scansat/kos/comms entries.
- `truenow-allowlist.test.ts` — one entry for `kerbcast.available` (ground-side
  install fact, same class as uplink health).
- The ratchet also caught **three genuine cross-mod name-drops** in my doc
  comments ("same pattern GonogoScansatUplink uses", etc.). Rather than
  allowlist prose across three other mods' lists — which would desensitise the
  gate — the comments were reworded. The full licence rationale (which *does*
  need to name RealAntennas as precedent) lives in the `.csproj` header and
  `NOTICE-KERBCAST.txt`, which are not scanned and are its proper home.

**CI** — `GonogoKerbcastUplink.Tests` added to the `mod` job; a
`GonogoKerbcastUplink` leg added to the `publish-mods` matrix. It needs **no
vendored Kerbcast.dll** (it reflects), so unlike the Scansat/kOS legs it builds
on today's `ksp-managed`. SpaceDock upload no-ops with a warning until
`vars.SPACEDOCK_MOD_ID_GONOGOKERBCASTUPLINK` exists — publishing stays
operator-gated.

---

## 8. What did NOT land, and why

### The `packages/kerbcast` client migration — **needs an operator decision**

Reason #1 ("bundle kerbcast client code properly and REMOVE it from the core
client") is **not done**. `packages/kerbcast` (`@ksp-gonogo/kerbcast-feed`) is
still bundled into the app.

It is deliberately not half-done, because the Uplink convention says a client
half lives at `mod/GonogoKerbcastUplink/client/` (picked up by the `mod/*/client`
workspace glob), and moving `packages/kerbcast` there is **not a file move**:

1. `packages/kerbcast` contains `KerbcastDataSource`, `DelayedPlayoutBuffer`,
   `frameDelay`, `useKerbcastStream`, `CameraFeed` — the **WebRTC media path**,
   which by design is *not* what this Uplink owns. An Uplink client that ships
   the media path is a category error; one that doesn't leaves the media package
   still bundled. Which of those the operator wants is a real choice.
2. `DelayedPlayoutBuffer` consumes `useViewClock()` — the delay authority the u4
   work built. That seam is load-bearing and must not be disturbed casually.
3. The u4 report records that the visible `CameraFeed` renders through the
   kerbcast SDK's own `SharedCameraFeed`, whose props expose no delay hook — the
   remaining video-delay step is a **kerbcast-SDK-side add in the sibling repo**,
   which is read-only here.

**Decision needed:** does the kerbcast Uplink's client half own (a) only the
control plane — a camera-inventory / docking-camera widget reading
`kerbcast.cameras` — leaving `packages/kerbcast` as the media package; or (b)
control *and* media, absorbing `packages/kerbcast` wholesale and making the
Uplink client depend on the kerbcast WebRTC SDK?

My recommendation is **(a)**: it matches the plane split this whole design rests
on, retires the *control* half of the tech debt, and keeps the media path where
the delay-authority seam already works. But it does not fully satisfy "REMOVE it
from the core client" on its own, so it is the operator's call, not mine.

### No client widget yet

Consequently no `registerComponent` for a camera-inventory widget. The topics are
carried and typed, so one drops in cleanly once (a)/(b) is settled. Note the
health row does **not** depend on this — it is already live.

### Not live-validated in KSP

The reflection surface is tested against shape-compatible stand-ins, but has
never met a real `Kerbcast.dll`. `Kerbcast.KerbcastControl`'s shape was read
directly from the sibling repo's source, so the risk is low, but "kerbcast's
surface moved" degrades to a `Reason` string rather than a crash by design.

### `ViewOf` / `AimAt` not surfaced

kerbcast's facade also exposes `ViewOf(flightId)` and `AimAt(worldPoint)`.
`AimAt` (point the camera at a world position) is a genuinely interesting future
command — deferred rather than guessed at, since its arg frame needs thought.

---

## 9. Verification

- `dotnet build mod/GonogoKerbcastUplink` — clean
- `dotnet test mod/GonogoKerbcastUplink.Tests` — 26/26
- `ContractShapeGateTests` — pass (Minor bump honest)
- `pnpm exec turbo typecheck --force --continue` — 33/33
- `pnpm exec turbo test --force --continue --concurrency=1` — see report
- `pnpm install --frozen-lockfile` — see report

**Pre-existing, verified against the untouched base:** the C# uplink projects do
not build on a clean tree — they HintPath a gitignored
`local_docs/telemachus-fork/references`. Confirmed by building the *untouched*
`GonogoRealAntennasUplink`, which fails identically. Pass
`-p:KspManaged=/path/to/references` to build locally; CI passes its own.
