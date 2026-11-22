/** Supabase Auth performs Turnstile Siteverify using its protected CAPTCHA secret.
 * Do not consume the same token a second time in our own server action. */
export function captchaTokenFromForm(form: FormData): string | null {
  const value = form.get("cf-turnstile-response");
  return typeof value === "string" && value.length > 0 && value.length <= 2048 ? value : null;
}
