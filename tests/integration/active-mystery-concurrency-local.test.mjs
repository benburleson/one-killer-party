import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";

const container = "supabase_db_one-killer-party";
const psql = (sql) => execFileSync("docker", [
  "exec", container, "psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1",
  "-U", "postgres", "-d", "postgres", "-c", sql,
], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("creation serializes activation updates for absent and present snapshots", async () => {
  const status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
  }));
  assert.equal(status.API_URL, "http://127.0.0.1:54321");
  assert.match(status.DB_URL, /^postgres(?:ql)?:\/\/[^@]+@127\.0\.0\.1:54322\/postgres$/);
  const id = `synthetic-${randomUUID()}`;
  const host = randomUUID();
  const digest = "d".repeat(64);
  psql(`INSERT INTO auth.users (id,aud,role,email) VALUES ('${host}','authenticated','authenticated','${host}@test.invalid');
    INSERT INTO private_mystery.published_versions (mystery_id,version,schema_version,digest_sha256,object_path,rule_set_id,provenance,approved_by,approval_reference)
    VALUES ('${id}','v1',1,'${digest}','${id}/v1/${digest}.json','eight-role-prototype-v1','synthetic:test','test-operator','test');
    CREATE FUNCTION private_mystery.test_delay_creation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_catalog.pg_sleep(3); RETURN NEW; END $$;
    CREATE TRIGGER test_delay_creation BEFORE INSERT ON public.parties FOR EACH ROW EXECUTE FUNCTION private_mystery.test_delay_creation();`);
  try {
    for (const active of [false, true]) {
      psql(active
        ? `UPDATE private_mystery.active_version SET mystery_id='${id}',version='v1',schema_version=1,digest_sha256='${digest}' WHERE singleton`
        : "UPDATE private_mystery.active_version SET mystery_id=NULL,version=NULL,schema_version=NULL,digest_sha256=NULL WHERE singleton");
      const party = randomUUID();
      const verifier = createHash("sha256").update(party).digest("hex");
      const app = `test-active-${randomUUID()}`;
      const creation = spawn("docker", ["exec", "-e", `PGAPPNAME=${app}`, container, "psql", "-X", "-A", "-t",
        "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c",
        `SELECT * FROM public.create_pinned_host_party('${host}','${party}',decode('${verifier}','hex'),
         ${active ? `'${id}','v1',1,'${digest}',ARRAY['role-1','role-2','role-3','role-4','role-5','role-6','role-7','role-8']` : "NULL,NULL,NULL,NULL,NULL"})`,
      ], { stdio: ["ignore", "pipe", "pipe"] });
      const done = new Promise((resolve, reject) => {
        creation.once("error", reject);
        creation.once("close", (code) => code === 0 ? resolve() : reject(new Error("creation failed")));
      });
      let sleeping = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        if (psql(`SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE application_name='${app}' AND wait_event='PgSleep'`) === "1") {
          sleeping = true;
          break;
        }
        await sleep(50);
      }
      assert.equal(sleeping, true, "creation reached delayed insert while holding the pointer lock");
      const start = Date.now();
      psql(active
        ? "UPDATE private_mystery.active_version SET mystery_id=NULL,version=NULL,schema_version=NULL,digest_sha256=NULL WHERE singleton"
        : `UPDATE private_mystery.active_version SET mystery_id='${id}',version='v1',schema_version=1,digest_sha256='${digest}' WHERE singleton`);
      assert.ok(Date.now() - start >= 500, "activation waited for creation's transaction");
      await done;
      assert.equal(psql(`SELECT mystery_id FROM public.parties WHERE id='${party}'`),
        active ? id : "blackwood-affair");
    }
  } finally {
    psql("DROP TRIGGER IF EXISTS test_delay_creation ON public.parties; DROP FUNCTION IF EXISTS private_mystery.test_delay_creation(); UPDATE private_mystery.active_version SET mystery_id=NULL,version=NULL,schema_version=NULL,digest_sha256=NULL WHERE singleton");
  }
});
