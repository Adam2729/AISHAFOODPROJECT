import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center gap-6 p-6">
      <h1 className="text-4xl font-bold">AishaFoodProject Backend</h1>
      <p className="text-slate-600">
        Marketplace backend for Santo Domingo with Admin and Merchant panels.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/admin" className="rounded-xl border px-4 py-2">
          Open Admin Panel
        </Link>
        <Link href="/merchant/login" className="rounded-xl border px-4 py-2">
          Open Merchant Panel
        </Link>
      </div>
    </main>
  );
}
