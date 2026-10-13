import type { Metadata } from "next";
import Link from "next/link";
import { peekOneTimeToken } from "@/lib/tokens";
import { AuthShell } from "@/components/auth-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { VerifyEmailForm } from "./verify-email-form";

export const metadata: Metadata = { title: "Confirm your email" };

export default async function VerifyEmailPage({ params }: PageProps<"/verify-email/[token]">) {
  const { token } = await params;
  const rec = await peekOneTimeToken(token, "verify_email");
  if (!rec) {
    return (
      <AuthShell title="Link expired">
        <div className="space-y-4">
          <Alert variant="destructive"><AlertTitle>This link is invalid or has expired.</AlertTitle><AlertDescription>Confirmation links work once and expire after 24 hours. Sign in and request a new one from your account page.</AlertDescription></Alert>
          <Button className="w-full" render={<Link href="/account" />}>Go to my account</Button>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Confirm your email" subtitle={rec.email}>
      <VerifyEmailForm token={token} />
    </AuthShell>
  );
}
