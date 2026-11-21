
import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#171923] px-6 text-center text-white">
      <p className="mb-6 tracking-[0.3em] text-amber-300">
        ONE KILLER PARTY
      </p>

      <h1 className="max-w-2xl text-5xl font-bold md:text-7xl">
        Everyone&apos;s a suspect.
      </h1>

      <p className="mt-6 max-w-md text-lg text-gray-300">
        An unforgettable murder mystery experience
        with your closest friends.
      </p>

      <div className="mt-10 flex flex-wrap justify-center gap-4">
        <Link
          href="/host"
          prefetch={false}
          className="rounded-lg bg-amber-300 px-6 py-3 font-semibold text-gray-950"
        >
          Host a party
        </Link>
      </div>

      <p className="mt-16 text-sm text-gray-400">
        The Blackwood Affair · First Mystery
      </p>
    </main>
  );
}
