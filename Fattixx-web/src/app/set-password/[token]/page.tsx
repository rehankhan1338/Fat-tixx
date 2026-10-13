import type { Metadata } from "next";
import Link from "next/link";
import { peekOneTimeToken } from "@/lib/tokens";
import { AuthShell } from "@/components/auth-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Set your password" };

export default async function SetPasswordPage({ params }: PageProps<"/set-password/[token]">) {
  const { token } = await params;
  const rec = (await peekOneTimeToken(token, "set_password")) ?? (await peekOneTimeToken(token, "reset_password"));

  if (!rec) {
    return (
      <AuthShell title="Link expired">
        <div className="space-y-4">
          <Alert variant="destructive"><AlertTitle>This link is invalid or has expired.</AlertTitle><AlertDescription>Password links work once and expire after a while.</AlertDescription></Alert>
          <Button className="w-full" render={<Link href="/forgot-password" />}>Request a new link</Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={rec.purpose === "reset_password" ? "Choose a new password" : "Set your password"} subtitle={`for ${rec.email}`}>
      <SetPasswordForm token={token} />
    </AuthShell>
  );
}
