import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { homeFor } from "@/lib/authz";
import { AuthShell } from "@/components/auth-shell";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage() {
  const session = await getSession();
  if (session) redirect(await homeFor(session));
  return (
    <AuthShell
      title="Create your account"
      subtitle="Keep all your tickets and orders in one place. You can also buy as a guest without an account."
      footer={<>Already have an account? <Link href="/login" className="text-primary underline-offset-4 hover:underline">Sign in</Link></>}
    >
      <RegisterForm />
    </AuthShell>
  );
}
