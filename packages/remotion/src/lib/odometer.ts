// Odometer layout for NumberCounter: the FINAL value's locale format fixes the cell layout (digits, separators,
// currency, percent); each digit cell rolls continuously with the animated value (lowest place continuous, higher
// places carry when the next lower digit passes 9). Leading digits fade/collapse in as the value grows. Pure.
import { formatNumber, formatNumberParts, type NumberFormatSpec } from "./text";

export type OdoCell =
  | { kind: "digit"; place: number; pos: number; visible: number }
  | { kind: "text"; text: string; visible: number; role: string };

const frac = (x: number) => x - Math.floor(x);

export function odometerCells(finalValue: number, current: number, spec: NumberFormatSpec): OdoCell[] {
  if (spec.format === "compact" || !Number.isFinite(finalValue) || !Number.isFinite(current)) {
    return [{ kind: "text", text: formatNumber(current, spec), visible: 1, role: "all" }];
  }
  const parts = formatNumberParts(finalValue, spec);
  const nInt = parts.filter((p) => p.type === "integer").reduce((a, p) => a + p.value.length, 0);
  const decimals = Math.max(0, Math.min(3, Math.round(spec.decimals)));
  const minPlace = -decimals;
  const m = Math.abs(current);
  const cells: OdoCell[] = [];
  let intSeen = 0;
  let fracSeen = 0;
  let lastDigitVis = 1;
  const hasMinus = parts.some((p) => p.type === "minusSign");
  if (current < 0 && !hasMinus) cells.push({ kind: "text", text: "-", visible: 1, role: "minusSign" });
  for (const p of parts) {
    if (p.type === "integer" || p.type === "fraction") {
      for (const _ch of p.value) {
        const place = p.type === "integer" ? nInt - 1 - intSeen++ : -1 - fracSeen++;
        const c = m / Math.pow(10, place);
        let pos: number;
        if (place <= minPlace) pos = c % 10;
        else pos = (Math.floor(c) % 10) + Math.max(0, Math.min(1, frac(c) * 10 - 9));
        let visible = 1;
        if (place >= 1) {
          const lo = 0.9 * Math.pow(10, place);
          visible = m >= Math.pow(10, place) ? 1 : Math.max(0, Math.min(1, (m - lo) / (0.1 * Math.pow(10, place))));
        }
        lastDigitVis = visible;
        cells.push({ kind: "digit", place, pos: Number.isFinite(pos) ? pos : 0, visible });
      }
    } else if (p.type === "group") {
      cells.push({ kind: "text", text: p.value, visible: lastDigitVis, role: "group" });
    } else if (p.type === "minusSign") {
      cells.push({ kind: "text", text: p.value, visible: current < 0 ? 1 : 0, role: "minusSign" });
    } else {
      cells.push({ kind: "text", text: p.value, visible: 1, role: p.type });
    }
  }
  return cells;
}

/** The digit shown by a cell (rounded position) — what the counter reads at rest. */
export const cellDigit = (pos: number): number => ((Math.round(pos) % 10) + 10) % 10;
