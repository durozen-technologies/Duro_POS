export type ReceiptPaperMm = 58 | 80;

export type ReceiptPaperProfile = {
  mm: ReceiptPaperMm;
  cols: number;
  canvasWidth: number;
  webViewWidth: number;
  imageWidth: number;
  /** Multiplier for receipt canvas/CSS font sizes (1 = current 58mm look). */
  fontScale: number;
  dividerKey: "HR3_58MM" | "HR3_80MM";
};

export const DEFAULT_RECEIPT_PAPER_MM: ReceiptPaperMm = 58;

const RECEIPT_PAPER_PROFILES: Record<ReceiptPaperMm, ReceiptPaperProfile> = {
  58: {
    mm: 58,
    cols: 32,
    canvasWidth: 380,
    webViewWidth: 404,
    imageWidth: 380,
    fontScale: 1,
    dividerKey: "HR3_58MM",
  },
  80: {
    mm: 80,
    cols: 48,
    canvasWidth: 576,
    webViewWidth: 600,
    imageWidth: 576,
    // Wider paper: bump type ~30% so thermal output is easier to read.
    fontScale: 1.3,
    dividerKey: "HR3_80MM",
  },
};

export function normalizeReceiptPaperMm(value: unknown): ReceiptPaperMm {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (numeric === 80) {
    return 80;
  }
  return 58;
}

export function getReceiptPaperProfile(mm?: ReceiptPaperMm | null): ReceiptPaperProfile {
  return RECEIPT_PAPER_PROFILES[normalizeReceiptPaperMm(mm)];
}

export function scaleReceiptFontSize(size: number, fontScale: number): number {
  return Math.max(1, Math.round(size * fontScale));
}
