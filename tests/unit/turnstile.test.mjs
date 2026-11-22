import assert from "node:assert/strict";
import { test } from "node:test";
import { captchaTokenFromForm } from "../../src/lib/turnstile-token.ts";

test("Turnstile token is required, bounded, and is not coerced from non-string values", () => {
  const form = new FormData();
  assert.equal(captchaTokenFromForm(form), null);
  form.set("cf-turnstile-response", "XXXX.DUMMY.TOKEN.XXXX");
  assert.equal(captchaTokenFromForm(form), "XXXX.DUMMY.TOKEN.XXXX");
  form.set("cf-turnstile-response", "x".repeat(2049));
  assert.equal(captchaTokenFromForm(form), null);
  form.set("cf-turnstile-response", "");
  assert.equal(captchaTokenFromForm(form), null);
});
