import type { Artwork, SemanticPen } from "../lib/schema";
import type { SketchPanel } from "../lib/sketch-panels";
import type { Region } from "../lib/scene/schema";
import type { AlgorithmClip } from "../lib/scene/transfer";
import type { FrameId } from "../lib/workspace";
import type { CodePreviewHandle } from "../components/code-preview";

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
  /** The frame's current request number (changes when its work is cancelled or replaced). */
  requestId: (owner: string) => number;
  /** The frame the user is on now (AI work that finishes elsewhere does not pull the view back). */
  active?: () => string;
  toast: (message: string) => void;
  focus: (frame: FrameId) => void;
  /** Add a pen to the toolbar (made with a free id and color); null when the toolbar is full. */
  addPen: (make: (id: string, color: string) => SemanticPen | null) => SemanticPen | null;
  /** A pen as it reads now (a transformation pen follows its minimal example frame). */
  resolvePen: (pen: SemanticPen) => SemanticPen;
  /** Studio-wide algorithm clipboard, shared by every sketch. */
  clip: () => AlgorithmClip | null;
  setClip: (clip: AlgorithmClip) => void;
  activate: (owner: string) => void;
  /** Add frames beside `fromId` (a grid for several) and return their ids; fewer when the board is full. No AI involved. */
  createFrames: (fromId: string, names: string[]) => string[];
  /** The running result of a frame, if it is mounted. */
  preview: (owner: string) => CodePreviewHandle | undefined;
};
