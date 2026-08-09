export interface LabelSize {
  id: string;
  name: string;
  /** physical size in mm, landscape (width >= height) */
  wMm: number;
  hMm: number;
  /** printable dots override for the width axis (some printers clip the nominal size) */
  wDots?: number;
  hDots?: number;
}

export interface PrinterPreset {
  id: string;
  name: string;
  dpi: number;
  labels: LabelSize[];
}

// Brother QL printers are 300dpi and share the DK label system.
// The 62mm axis prints 696 dots (not the nominal 732); 29mm prints 271.
const DK_LABELS: LabelSize[] = [
  { id: 'dk1209', name: '62 × 29 mm die-cut (DK-1209)', wMm: 62, hMm: 29, wDots: 696, hDots: 271 },
  { id: 'dk1201', name: '90 × 29 mm address (DK-1201)', wMm: 90, hMm: 29, wDots: 991, hDots: 271 },
  { id: 'dk1208', name: '90 × 38 mm address (DK-1208)', wMm: 90, hMm: 38, wDots: 991, hDots: 413 },
  { id: 'dk1204', name: '54 × 17 mm multipurpose (DK-1204)', wMm: 54, hMm: 17, wDots: 566, hDots: 165 },
  // Continuous 62mm tape: the 62mm axis is the fixed tape width (696 printable
  // dots), the other axis is the cut length and is free. Putting 62mm on the
  // width means the @page rule matches how the roll actually feeds — page width
  // = tape width, page length = the cut — so these print without the driver
  // rotating anything. Shorter cuts give a less-tall label than the 100mm one.
  { id: 'dk2205-25', name: '62 × 25 mm cut from continuous 62 mm (DK-2205)', wMm: 62, hMm: 25, wDots: 696 },
  { id: 'dk2205-29', name: '62 × 29 mm cut from continuous 62 mm (DK-2205)', wMm: 62, hMm: 29, wDots: 696 },
  { id: 'dk2205-38', name: '62 × 38 mm cut from continuous 62 mm (DK-2205)', wMm: 62, hMm: 38, wDots: 696 },
  { id: 'dk2205-50', name: '62 × 50 mm cut from continuous 62 mm (DK-2205)', wMm: 62, hMm: 50, wDots: 696 },
  { id: 'dk2205-100', name: '100 × 62 mm on continuous 62 mm (DK-2205)', wMm: 100, hMm: 62, wDots: 1181, hDots: 696 }
];

const QL_WIDE_EXTRA: LabelSize[] = [
  { id: 'dk1241', name: '152 × 102 mm shipping (DK-1241)', wMm: 152, hMm: 102, wDots: 1795, hDots: 1164 }
];

export const PRINTERS: PrinterPreset[] = [
  { id: 'ql800', name: 'Brother QL-800 / 810W / 820NWB', dpi: 300, labels: DK_LABELS },
  { id: 'ql700', name: 'Brother QL-700 / 570 / 580N', dpi: 300, labels: DK_LABELS },
  { id: 'ql500', name: 'Brother QL-500 / 550 / 560', dpi: 300, labels: DK_LABELS },
  { id: 'ql1100', name: 'Brother QL-1100 / 1110NWB (wide)', dpi: 300, labels: [...DK_LABELS, ...QL_WIDE_EXTRA] },
  {
    id: 'dymo450',
    name: 'DYMO LabelWriter 450 / 550',
    dpi: 300,
    labels: [
      { id: 'd30252', name: '89 × 28 mm address (30252)', wMm: 89, hMm: 28 },
      { id: 'd30334', name: '57 × 32 mm multipurpose (30334)', wMm: 57, hMm: 32 },
      { id: 'd30336', name: '54 × 25 mm multipurpose (30336)', wMm: 54, hMm: 25 },
      { id: 'd30256', name: '102 × 59 mm shipping (30256)', wMm: 102, hMm: 59 }
    ]
  },
  {
    id: 'zebra203',
    name: 'Zebra ZD410 / ZD420 / GK420d (203 dpi)',
    dpi: 203,
    labels: [
      { id: 'z5731', name: '57 × 32 mm (2.25 × 1.25 in)', wMm: 57.2, hMm: 31.8 },
      { id: 'z5125', name: '51 × 25 mm (2 × 1 in)', wMm: 50.8, hMm: 25.4 },
      { id: 'z7625', name: '76 × 25 mm (3 × 1 in)', wMm: 76.2, hMm: 25.4 },
      { id: 'z10251', name: '102 × 51 mm (4 × 2 in)', wMm: 101.6, hMm: 50.8 }
    ]
  }
];

export interface LabelDims {
  wDots: number;
  hDots: number;
  wMm: number;
  hMm: number;
  dpi: number;
}

export function mmToDots(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

export function dimsForLabel(dpi: number, label: LabelSize): LabelDims {
  return {
    wDots: label.wDots ?? mmToDots(label.wMm, dpi),
    hDots: label.hDots ?? mmToDots(label.hMm, dpi),
    wMm: label.wMm,
    hMm: label.hMm,
    dpi
  };
}
