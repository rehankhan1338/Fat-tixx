import Image from "next/image";
import logo from "../../../public/images/brand/fattixx-logo.png";

/** The Fattixx wordmark (ticket logo), sized by height; the file keeps its transparent background. */
export default function Logo({ height = 36, className = "", priority = false }: { height?: number; className?: string; priority?: boolean }) {
  const width = Math.round((height * logo.width) / logo.height);
  return <Image src={logo} alt="Fattixx" width={width} height={height} priority={priority} className={className} />;
}
