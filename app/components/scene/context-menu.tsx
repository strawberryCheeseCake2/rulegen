import { useEffect, useState, type ReactNode } from "react";

export type MenuItem = { label: string; onSelect: () => void; disabled?: boolean; hint?: string } | "separator";
type Menu = { x: number; y: number; title?: string; items: MenuItem[] };

/** Right-click menu: `open(event, items)` from any onContextMenu handler, render `menu` once. */
export function useContextMenu(): [ReactNode, (event: React.MouseEvent, items: MenuItem[], title?: string) => void] {
  const [menu, setMenu] = useState<Menu | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("pointerdown", close); window.addEventListener("keydown", key); window.addEventListener("resize", close); window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", key); window.removeEventListener("resize", close); window.removeEventListener("scroll", close, true); };
  }, [menu]);
  const open = (event: React.MouseEvent, items: MenuItem[], title?: string) => {
    event.preventDefault(); event.stopPropagation();
    setMenu({ x: Math.min(event.clientX, window.innerWidth - 220), y: Math.min(event.clientY, window.innerHeight - 40 - items.length * 30), title, items });
  };
  const element = menu && <div className="context-menu" role="menu" aria-label={menu.title || "Context menu"} style={{ left: menu.x, top: menu.y }} onPointerDown={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}>
    {menu.title && <div className="context-menu-title">{menu.title}</div>}
    {menu.items.map((item, i) => item === "separator" ? <hr key={i} /> : <button key={i} role="menuitem" disabled={item.disabled} onClick={() => { setMenu(null); item.onSelect(); }}>{item.label}{item.hint && <small>{item.hint}</small>}</button>)}
  </div>;
  return [element, open];
}
