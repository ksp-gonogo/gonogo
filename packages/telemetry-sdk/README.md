# @gonogo/telemetry-sdk

TypeScript client SDK for the gonogo-native telemetry mod. The wire contract
(message envelopes, `Meta`, enums) is defined once in C# and generated into
this package — the SDK never redefines the shape by hand.

## Generated code — do not hand-edit

`src/__generated__/contract.ts` is produced by
[Reinforced.Typings](https://github.com/reinforced/Reinforced.Typings) from
the C# source of truth in `mod/Gonogo.Contract/`. The file carries its own
"generated, changes will be lost" header — treat that as load-bearing, not
boilerplate. If a type needs to change, change the C# class (or
`mod/Gonogo.Contract/RtConfig.cs` for export configuration) and regenerate;
never patch the emitted `.ts` directly.

Regenerate from the repo root:

```bash
pnpm codegen
```

This runs `mod/codegen.sh`, which builds `Gonogo.Contract.csproj` and invokes
the `rtcli` tool against the compiled assembly to rewrite
`src/__generated__/contract.ts`.

## The drift gate

```bash
pnpm codegen:check
```

Regenerates the contract and then runs `git diff --exit-code` against
`src/__generated__/`. A non-zero exit means one of two things:

- The C# contract changed and the generated output is out of date — commit
  the regenerated file alongside the C# change.
- The build is non-deterministic (unexpected member/type ordering from
  reflection) — this should not happen; see `RtConfig.Configure` if it ever
  does, since RT export order is explicit there rather than left to
  `GetProperties()` reflection order.

This is the check that should run in CI once dotnet is wired into the CI
image (tracked separately) — for now, run it locally before committing any
change under `mod/Gonogo.Contract/`.

## The hand-owned seams: `envelope.ts` and `client.ts`

`src/envelope.ts` defines `ServerMessage` and `ClientMessage` as discriminated
unions over the generated interfaces (`StreamData<unknown> | EventMsg | ...`).
Reinforced.Typings emits one interface per C# class — it has no way to know
which subset of those interfaces the transport layer treats as a "server
message" versus a "client message," so that grouping is authored by hand in
this file instead of generated. `envelope.ts` is covered by tests
(`envelope.test.ts`) and is the only source file in this package that isn't
derived from `__generated__/contract.ts`; everything else (`client.ts`,
`index.ts`) is built on top of the generated types plus this one seam.

`src/client.ts` has a second, smaller hand-owned seam: `SERVER_TYPE_TAGS`, the
runtime lookup `parseServerMessage` uses to validate an incoming envelope's
`type` tag against the `ServerMessage` union. It's a second hand-owned copy of
the union's membership (a `Set` can't be derived from a type at runtime), but
it's compile-time-guarded — `SERVER_TYPE_TAGS` is declared `satisfies
Record<ServerMessage["type"], true>`, so adding a variant to `ServerMessage`
without adding its tag to `SERVER_TYPE_TAGS` fails `tsc`.

## Usage

```ts
import { parseServerMessage, type ServerMessage } from "@gonogo/telemetry-sdk";

const msg: ServerMessage = parseServerMessage(rawJson);
```
