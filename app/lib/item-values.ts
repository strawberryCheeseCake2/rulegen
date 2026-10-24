// Values of single drawn items: a module reads a value as one item has it with
// m.v("<key>", id) (id = the item record's id), so an inspection handle on that item
// changes it alone. m.opt(<fallback>, "<key>", id) is the same read of a value that may not exist yet.

/** Whether the program reads this value per drawn item (`m.v("…/<property path>", id)`), so one item can differ. */
export function readsPerItem(code: string, key: string) {
  const path = key.slice(key.indexOf("/") + 1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`m\\.(?:v\\(|opt\\([^,()]*,)\\s*(["'])[^"']*/${path}\\1\\s*,`).test(code);
}
