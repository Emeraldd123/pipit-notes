// Document geometry shared by the canvas, exporter, and importers.
// A note is a vertical stack of fixed-size pages; strokes/images use DOCUMENT
// coordinates: x in [0, PAGE_W], y grows down across every page.
export const PAGE_W = 1240;
export const PAGE_H = 1754;
export const PAGE_GAP = 36;
export const pageTop = (i: number) => i * (PAGE_H + PAGE_GAP);
