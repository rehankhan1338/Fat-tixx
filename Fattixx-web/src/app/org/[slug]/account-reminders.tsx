"use client";

import Link from "next/link";
import { useState } from "react";
import { SetFirstPassword } from "@/components/set-first-password";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Shown on every dashboard page until done: paid events waiting for verification, and a password for an account that
 * signed up with a one-time code. "Later" hides the password reminder until the next page load.
 */
export function AccountReminders({ slug, heldEvents, verificationPending, passwordFor }: { slug: string; heldEvents: number; verificationPending: boolean; passwordFor: string | null }) {
  const [open, setOpen] = useState(false);
  const [later, setLater] = useState(false);
  return (
    <>
      {heldEvents > 0 ? (
        <Alert className="mb-4">
          <AlertTitle>{heldEvents === 1 ? "Your paid event is in review." : `${heldEvents} paid events are in review.`}</AlertTitle>
          <AlertDescription>
            {verificationPending
              ? "We’re verifying your organization. It goes live as soon as it is approved, and we’ll email you."
              : <>Only your team can see {heldEvents === 1 ? "it" : "them"} until your organization is verified. <Link href={`/org/${slug}/verify`} className="font-semibold underline underline-offset-4">Verify your organization</Link></>}
          </AlertDescription>
        </Alert>
      ) : null}
      {passwordFor && !later ? (
        <Alert className="mb-4">
          <AlertTitle>Set a password for your account</AlertTitle>
          <AlertDescription className="space-y-3">
            <span className="block">You sign in with a one-time code today. A password lets you sign in with {passwordFor} as well.</span>
            {open ? (
              <SetFirstPassword email={passwordFor} skip={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>} />
            ) : (
              <span className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setOpen(true)}>Set password</Button>
                <Button size="sm" variant="ghost" onClick={() => setLater(true)}>Later</Button>
              </span>
            )}
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}
