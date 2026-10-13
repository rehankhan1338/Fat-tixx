import { permanentRedirect } from "next/navigation";

/** The Ticketing terms now lives inside the Terms of Service (content/legal/terms.md); old links keep working. */
export default function Page() {
  permanentRedirect("/terms#s-5");
}
