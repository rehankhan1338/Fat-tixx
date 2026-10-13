import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { FindForm } from "./find-form";

export const metadata: Metadata = { title: "Find my tickets" };

export default function FindTicketsPage() {
  return (
    <AuthShell title="Find my tickets" subtitle="No account needed. Enter the email you used at checkout and we’ll send a secure link." footer={<Link href="/" className="text-primary underline-offset-4 hover:underline">Back to events</Link>}>
      <FindForm />
    </AuthShell>
  );
}
