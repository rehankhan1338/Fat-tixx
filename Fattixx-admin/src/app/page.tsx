import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AdminAuthShell } from "@admin/components/auth-shell";
import { LoginForm } from "./login-form";

/**
 * Homepage of the admin console: the platform staff sign-in. Super Admin, Support and Finance accounts sign in
 * here and only here; the public site's /login turns them away (see `loginWithPassword`). A visitor whose session
 * has no platform role still sees the form: signing in as staff replaces that session.
 */
export const metadata: Metadata = { title: "Sign in" };

export default async function AdminLoginPage({ searchParams }: PageProps<"/">) {
  const session = await getSession();
  if (session?.user.roles.length) redirect("/admin");
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  const site = env.APP_URL;

  return (
    <AdminAuthShell
      title="Admin sign in"
      subtitle="Fattixx platform staff only."
      footer={<>Not platform staff? <a href={`${site}/login`} className="text-primary underline-offset-4 hover:underline">Sign in on the main site</a></>}
    >
      <div className="space-y-4">
        {sp.denied ? <Alert variant="destructive"><AlertDescription>Your account does not have access to the admin console.</AlertDescription></Alert> : null}
        {sp.ready ? <Alert><AlertDescription>Your password is set. Sign in to open the console.</AlertDescription></Alert> : null}
        <LoginForm next={next} forgotHref={`${site}/forgot-password`} />
      </div>
    </AdminAuthShell>
  );
}
