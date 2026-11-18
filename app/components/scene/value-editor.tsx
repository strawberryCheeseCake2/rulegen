import type { ScalarValue } from "../../lib/scene/schema";
import { ScalarWidget } from "./scalar-widget";

/** A param's slider (number, color, option or toggle). */
export function ValueSlider({ value, label, onScalar }: { value: ScalarValue; label: string; onScalar: (path: string[], value: ScalarValue["value"]) => void }) {
  return <div className="value-socket socket-root"><div className="socket-scalar"><ScalarWidget value={value} label={label} onChange={raw => onScalar([], raw)} /></div></div>;
}
