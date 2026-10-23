import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { homeFor } from "@/lib/authz";
import { AuthShell } from "@/components/auth-shell";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const session = await getSession();
  const sp = await searchParams;
  // Only same-site paths (the action checks again with safeNext).
  const next = typeof sp.next === "string" && /^\/(?!\/)/.test(sp.next) ? sp.next : undefined;
  if (session) redirect(next ?? await homeFor(session));
  return (
    <AuthShell
      title="Create your account"
      subtitle="Keep all your tickets and orders in one place. You can also buy as a guest without an account."
      footer={<>Already have an account? <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="text-primary underline-offset-4 hover:underline">Sign in</Link></>}
    >
      <RegisterForm next={next} />
    </AuthShell>
  );
}
