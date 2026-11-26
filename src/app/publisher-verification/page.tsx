import type { Metadata } from "next";
import Link from "next/link";
import { PublisherVerification } from "./publisher-verification";

export const metadata: Metadata = {
  title: "Publisher verification | One Killer Party",
  description: "Get a one-time verification token for the publisher CLI.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/publisher-verification" },
};

export default function PublisherVerificationPage() {
  return <main className="min-h-screen bg-[#171923] px-6 py-12 text-white">
    <div className="mx-auto max-w-2xl">
      <Link href="/" prefetch={false} className="text-amber-300">ONE KILLER PARTY</Link>
      <h1 className="mt-8 text-3xl font-bold">Publisher verification</h1>
      <p className="mt-4">Use this page only when the publisher CLI asks for a CAPTCHA token. It does not sign you in or grant publishing access.</p>
      <p className="mt-4">Complete the challenge, copy the token, and paste it promptly into the CLI prompt. Tokens expire quickly and can be used only once. Keep the token private and clear your clipboard after use.</p>
      <PublisherVerification />
    </div>
  </main>;
}
