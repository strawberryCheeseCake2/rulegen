export type IconName = "select" | "collection" | "object" | "eye" | "eye-off" | "layers" | "function" | "interaction" | "trash" | "arrow" | "pen" | "eraser" | "lasso" | "hand" | "undo" | "redo" | "plus" | "minus" | "chevron" | "spark" | "code" | "close" | "edit" | "grid" | "play" | "pause" | "copy" | "upload" | "download" | "brush";
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    select: <path d="M5 3l14 8-6 2-2 6L5 3Z" />,
    collection: <><path d="M3 7h7l2 2h9v10H3V7Z" /><path d="M3 7V5h6l2 2" /></>,
    object: <><rect x="5" y="5" width="14" height="14" rx="3" /></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    "eye-off": <><path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.2 7.6A17 17 0 0 0 2 12s4 6 10 6a9.6 9.6 0 0 0 4.3-1" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>,
    function: <><path d="M14 4h-1a3 3 0 0 0-3 3v10a3 3 0 0 1-3 3H6M7 11h8M15 14l5 5M20 14l-5 5" /></>,
    interaction: <><path d="m7 5 1 15 4-5 5 5 3-3-5-5 5-4L7 5ZM3 3l2 2M9 1v2M1 9h2" /></>,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>,
    pause: <><path d="M8 4v16M16 4v16" /></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6" /></>,
    download: <><path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4" /></>,
    brush: <><path d="m9 15 10-12 3 3-12 10M9 15c-5-2-3 4-7 6 6 1 10-1 8-5" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    pen: <><path d="m4 20 4-1L20 7l-3-3L5 16l-1 4ZM14 7l3 3" /></>,
    eraser: <><path d="m4 13 9-9 7 7-9 9H7l-3-3v-4ZM9 8l7 7M11 20h9" /></>,
    lasso: <><ellipse cx="12" cy="9" rx="9" ry="6" strokeDasharray="3 3" /><path d="M6 14c-5 7 6 9 5 3" /></>,
    hand: <><path d="M8 12V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v9c0 5-3 7-7 7-3 0-5-2-7-5l-3-4c-1-2 1-4 3-2l2 2Z" /></>,
    undo: <><path d="M8 4 3 9l5 5M3 9h11a6 6 0 0 1 0 12" /></>,
    redo: <><path d="m16 4 5 5-5 5M21 9H10a6 6 0 0 0 0 12" /></>,
    plus: <path d="M12 5v14M5 12h14" />, minus: <path d="M5 12h14" />,
    chevron: <path d="m9 5 7 7-7 7" />, spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4M18 4h4" /></>,
    code: <><path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />, edit: <><path d="m5 16 10-10 3 3L8 19H5v-3ZM14 7l3 3" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    play: <path d="m8 4 12 8-12 8V4Z" />, copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
