import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="Reset your password" subtitle="We will email you a link to choose a new one." footer={<Link href="/login" className="text-primary underline-offset-4 hover:underline">Back to sign in</Link>}>
      <ForgotForm />
    </AuthShell>
  );
}
