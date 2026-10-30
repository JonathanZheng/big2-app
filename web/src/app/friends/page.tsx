import { ComingSoon } from "@/components/coming-soon";
import { MODES } from "@/lib/modes";

export default function Page() {
  const mode = MODES[1];
  return <ComingSoon title={mode.label} summary={mode.summary} />;
}
