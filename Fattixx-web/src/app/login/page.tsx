import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { homeFor } from "@/lib/authz";
import { AuthShell } from "@/components/auth-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const session = await getSession();
  if (session) redirect(await homeFor(session));
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;

  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back to Fat Tixx."
      footer={<>New here? <Link href="/register" className="text-primary underline-offset-4 hover:underline">Create an account</Link> · <Link href="/tickets/find" className="text-primary underline-offset-4 hover:underline">Find my tickets</Link></>}
    >
      <div className="space-y-4">
        {sp.expired ? <Alert><AlertDescription>Your session expired. Please sign in again.</AlertDescription></Alert> : null}
        {sp.denied ? <Alert variant="destructive"><AlertDescription>Your account does not have access to that area.</AlertDescription></Alert> : null}
        <LoginForm next={next} />
      </div>
    </AuthShell>
  );
}
