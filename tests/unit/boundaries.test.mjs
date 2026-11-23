import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../../src/", import.meta.url);
const sources = readdirSync(root, { recursive: true })
  .filter((name) => /\.tsx?$/.test(name))
  .map((name) => ({ name: name.replaceAll("\\", "/"), text: readFileSync(new URL(name, root), "utf8") }));
const serverOnly = (text) => /^import "server-only";$/m.test(text);
const named = (pattern) => sources.filter(({ text }) => pattern.test(text)).map(({ name }) => name).sort();

test("the service-role key is read only by server-only modules and one database client", () => {
  assert.deepEqual(named(/SUPABASE_SERVICE_ROLE_KEY/), ["lib/lobby/service.ts", "lib/supabase/service-client.ts"]);
  assert.deepEqual(named(/from "@supabase\/supabase-js"/).filter((name) =>
    /\bcreateClient\b/.test(sources.find((source) => source.name === name).text)), ["lib/supabase/service-client.ts"]);
  for (const { name, text } of sources) {
    if (/SUPABASE_SERVICE_ROLE_KEY|serviceRoleClient|BLACKWOOD_PUBLIC_CHARACTERS = /.test(text) && !name.startsWith("app/")) {
      assert.equal(serverOnly(text), true, `${name} must import server-only`);
    }
    assert.doesNotMatch(text, /NEXT_PUBLIC_[A-Z_]*(SERVICE|SECRET)/, name);
  }
});

test("client components import no server or Node-only library modules", () => {
  const clients = sources.filter(({ text }) => /^"use client";$/m.test(text));
  assert.ok(clients.length >= 5);
  for (const { name, text } of clients) {
    const imports = [...text.matchAll(/^import (?!type )[^;]*? from "([^"]+)";$/gms)].map(([, target]) => target);
    for (const target of imports) {
      assert.doesNotMatch(target, /^node:|server-only|^@\/lib\/(host|supabase|mystery-content)\/|^@\/lib\/lobby\/(core|service|public-characters|index)$|^@\/lib\/request$/,
        `${name} imports ${target}`);
    }
  }
  const inviteCode = sources.find(({ name }) => name === "lib/lobby/invite-code.ts").text;
  assert.doesNotMatch(inviteCode, /^import /m, "the client-safe invite parser must stay dependency-free");
});
