import { LinkIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CopyButton } from "@/components/copy-button";

/** Shown after inviting someone when no mail server is configured: the admin hands the link over directly. */
export function InviteLinkNotice({ link, message }: { link: string; message?: string }) {
  return (
    <Alert>
      <LinkIcon />
      <AlertTitle>Password set-up link</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{message ?? "The invitation email was recorded in the outbox. Until SMTP is configured, share this link directly. It works once and expires in 7 days."}</p>
        <div className="flex min-w-0 items-center gap-2">
          {/* the link wraps instead of widening the alert (and the dialog around it) */}
          <code className="block min-w-0 flex-1 rounded bg-muted px-2 py-1 font-mono text-xs break-all">{link}</code>
          <CopyButton value={link} />
        </div>
      </AlertDescription>
    </Alert>
  );
}
