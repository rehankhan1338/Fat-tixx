import { permanentRedirect } from "next/navigation";

/** The Organizer Agreement now lives inside the Terms of Service (content/legal/terms.md); old links keep working. */
export default function Page() {
  permanentRedirect("/terms#organizer-agreement");
}
