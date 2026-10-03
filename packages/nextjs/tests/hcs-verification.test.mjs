import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { encodeAbiParameters, encodeEventTopics } from "viem";

// Use the project's compiler so the test also runs on the supported Node 20 release.
const source = await readFile(new URL("../utils/hcs/verification.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const temporary = await mkdtemp(join(tmpdir(), "ogv-hcs-test-"));
let verifier;
try {
  const modulePath = join(temporary, "verification.mjs");
  await writeFile(modulePath, compiled.replace('from "viem"', `from ${JSON.stringify(import.meta.resolve("viem"))}`));
  verifier = await import(pathToFileURL(modulePath).href);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
const { decodeAuditEntry, verifyAuditEntry } = verifier;

const vault = "0x" + "ab".repeat(20),
  other = "0x" + "cd".repeat(20),
  user = "0x" + "ef".repeat(20);
const id = "0.0.1234",
  numeric = "0x" + BigInt(1234).toString(16).padStart(40, "0");
const wire = {
  s: "ogv.audit/1",
  c: 296,
  k: "deposit",
  v: vault,
  u: user,
  a: "10",
  p: "100",
  tx: "0x" + "11".repeat(32),
  li: 3,
  b: 1,
};
const entry = () => decodeAuditEntry(JSON.stringify(wire), 1, "123.000000001");
const topics = encodeEventTopics({
  abi: [
    {
      type: "event",
      name: "Deposited",
      inputs: [
        { name: "user", type: "address", indexed: true },
        { name: "amount", type: "uint256" },
        { name: "price", type: "uint256" },
      ],
    },
  ],
  eventName: "Deposited",
  args: { user },
});
const log = {
  index: 3,
  address: vault,
  contract_id: id,
  topics,
  data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [10n, 100n]),
};
async function check(overrides = {}, options = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(url);
    if (options.throw) throw new Error("offline");
    if (options.http) return { ok: false };
    return {
      ok: true,
      json: async () =>
        url.endsWith(vault)
          ? (options.contract ?? { contract_id: id, evm_address: vault })
          : (options.result ?? { result: "SUCCESS", logs: [{ ...log, ...options.log }] }),
    };
  };
  try {
    return { status: await verifyAuditEntry(296, vault, { ...entry(), ...overrides }), calls };
  } finally {
    globalThis.fetch = original;
  }
}
test("accepts real-shaped alias emitter", async () => assert.equal((await check()).status, "verified"));
test("accepts independently resolved long-zero emitter", async () =>
  assert.equal((await check({}, { log: { address: numeric } })).status, "verified"));
test("rejects same event emitted by another vault", async () =>
  assert.equal((await check({}, { log: { address: other } })).status, "mismatch"));
test("rejects different emitter contract ID even with alias", async () =>
  assert.equal((await check({}, { log: { contract_id: "0.0.5678" } })).status, "mismatch"));
test("rejects wrong wire vault before any fetch", async () => {
  const x = await check({ vault: other });
  assert.equal(x.status, "mismatch");
  assert.equal(x.calls.length, 0);
});
test("rejects wrong wire chain before any fetch", async () => {
  const x = await check({ chainId: 295 });
  assert.equal(x.status, "mismatch");
  assert.equal(x.calls.length, 0);
});
test("rejects changed event values", async () => assert.equal((await check({ amount: 11n })).status, "mismatch"));
test("rejects changed event kind", async () => assert.equal((await check({ kind: "withdraw" })).status, "mismatch"));
test("rejects absent log", async () => assert.equal((await check({ logIndex: 5 })).status, "mismatch"));
test("rejects failed transaction", async () =>
  assert.equal((await check({}, { result: { result: "CONTRACT_REVERT_EXECUTED", logs: [] } })).status, "mismatch"));
test("HTTP failure remains unknown", async () => assert.equal((await check({}, { http: true })).status, "unknown"));
test("transport failure remains unknown", async () =>
  assert.equal((await check({}, { throw: true })).status, "unknown"));
test("malformed mirror response remains unknown", async () =>
  assert.equal((await check({}, { result: {} })).status, "unknown"));
test("missing emitter remains unknown", async () =>
  assert.equal((await check({}, { log: { address: undefined } })).status, "unknown"));
test("metadata resolving to another alias remains unknown", async () =>
  assert.equal((await check({}, { contract: { contract_id: id, evm_address: other } })).status, "unknown"));
test("unsupported network never verifies", async () =>
  assert.equal(await verifyAuditEntry(31337, vault, entry()), "unknown"));
test("valid wire retains chain identity", () => assert.equal(entry().chainId, 296));
test("malformed wire fields are rejected", () => {
  for (const patch of [
    { c: -1 },
    { li: -1 },
    { li: 1.2 },
    { b: -1 },
    { a: "-10" },
    { a: 10 },
    { p: "x" },
    { tx: "https://evil.test" },
    { u: "0x123" },
    { v: "0x123" },
    { k: "drain" },
    { s: "other/1" },
  ])
    assert.equal(decodeAuditEntry(JSON.stringify({ ...wire, ...patch }), 1, "123.000000001"), null);
  assert.equal(decodeAuditEntry("{}", 1, "123.000000001"), null);
  assert.equal(decodeAuditEntry(JSON.stringify(wire), 0, "123.000000001"), null);
});

test("public testnet topic entries independently verify", { skip: process.env.LIVE_HCS_TEST !== "1" }, async () => {
  const response = await fetch(
    "https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10841114/messages?order=asc&limit=10",
    { signal: AbortSignal.timeout(15000) },
  );
  assert.ok(response.ok);
  const body = await response.json();
  const entries = body.messages
    .map(m =>
      decodeAuditEntry(Buffer.from(m.message, "base64").toString("utf8"), m.sequence_number, m.consensus_timestamp),
    )
    .filter(Boolean);
  assert.ok(entries.length >= 2);
  for (const e of entries.slice(0, 2))
    assert.equal(await verifyAuditEntry(296, "0x1a6002485B5729088023CAdCd378CA22f28fC287", e), "verified");
});
