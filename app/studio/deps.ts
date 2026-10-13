import type { Artwork, SemanticPen } from "../lib/schema";
import type { SketchPanel } from "../lib/sketch-panels";
import type { Region } from "../lib/scene/schema";
import type { AlgorithmClip } from "../lib/scene/transfer";
import type { FrameId } from "../lib/workspace";

export type PanelPatch = Partial<SketchPanel> | ((panel: SketchPanel) => Partial<SketchPanel>);

/** What the studio actions need from the route. Keeps actions free of React state plumbing. */
export type StudioDeps = {
  panel: (owner: string) => SketchPanel;
  updatePanel: (owner: string, patch: PanelPatch) => void;
  /** POST /api/generate with recovery context; rejects on error or cancellation. */
  request: (intent: string, body: object, owner: string) => Promise<unknown>;
  /** Runs work with the owner's loading banner and error reporting. */
  task: (label: string, work: () => Promise<void>, owner: string) => Promise<void>;
  /** The frame as seen: its rendered result (if any) under its strokes. */
  capture: (owner: string, full?: boolean) => Promise<{ image: string; region: Region }>;
  artwork: (owner: string) => Artwork | undefined;
  documentId: () => number;
  requestId: () => number;
  toast: (message: string) => void;
  focus: (frame: FrameId) => void;
  addPen: (make: (id: string, color: string) => SemanticPen) => void;
  /** Studio-wide algorithm clipboard, shared by every sketch. */
  clip: () => AlgorithmClip | null;
  setClip: (clip: AlgorithmClip) => void;
  activate: (owner: string) => void;
  /** Add a sketch frame beside `fromId` and return its id (no AI involved). */
  createFrame: (fromId: string, name: string) => string | null;
};
