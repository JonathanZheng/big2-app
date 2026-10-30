import { ComingSoon } from "@/components/coming-soon";
import { MODES } from "@/lib/modes";

export default function Page() {
  const mode = MODES[0];
  return <ComingSoon title={mode.label} summary={mode.summary} />;
}
