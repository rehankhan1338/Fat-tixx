import { permanentRedirect } from "next/navigation";

/** The Refund policy now lives inside the Terms of Service (content/legal/terms.md); old links keep working. */
export default function Page() {
  permanentRedirect("/terms#s-5-4");
}
