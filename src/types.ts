export type NoteTool = "pencil" | "pen" | "highlighter" | "marker";
export type NotePaper = "blank" | "ruled" | "grid" | "dotted" | "cornell";

export type StrokeInput = {
  tool: NoteTool;
  color: string;
  width: number;
  points: { x: number; y: number; p?: number }[];
};

export type NotebookRec = { id: string; name: string; color: string; createdAt: number };

export type NoteMeta = {
  id: string;
  title: string;
  notebookId: string | null;
  paper: NotePaper;
  pageCount: number;
  tags: string[];
  isPinned: boolean;
  createdAt: number;
  updatedAt: number;
  strokeCount: number;
  imageCount: number;
};

export type StrokeRec = StrokeInput & { id: string; noteId: string; ord: number };

export type ImageRec = {
  id: string;
  noteId: string;
  blob: Blob;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  createdAt: number;
};

// Text / code blocks that live on a note, positioned in document coordinates.
export type BlockKind = "code" | "text" | "math" | "graph";
export type BlockRec = {
  id: string;
  noteId: string;
  kind: BlockKind;
  x: number;
  y: number;
  width: number;
  height: number;
  /** code / text / LaTeX source */
  text: string;
  lang?: "python";
  output?: string;
  /** plots etc. produced by running the block (PNG data URLs) */
  images?: string[];
  createdAt: number;
};

export type VersionRec = { id: string; noteId: string; createdAt: number; strokeCount: number; strokes: StrokeInput[] };

export type PageTextRec = {
  key: string; // `${noteId}:${page}:${source}`
  noteId: string;
  page: number;
  /** where the text came from: handwriting recognition, or a PDF's own text layer */
  source: "ink" | "pdf";
  text: string;
  /** fingerprint of the page content when it was read (to skip unchanged pages) */
  hash: string;
  updatedAt: number;
};

// --- diagnostics ---------------------------------------------------------------
export type LogLevel = "info" | "warn" | "error";
/** One diagnostics event. Never contains note content, titles, or credentials. */
export type LogEntry = {
  id?: number;
  t: number;
  session: string;
  level: LogLevel;
  area: string;
  msg: string;
  data?: Record<string, unknown>;
};
