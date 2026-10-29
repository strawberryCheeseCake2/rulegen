import type { Region } from "./scene/schema";

// A brush's thumbnail in the Brush panel: its master's box cut from the master
// frame's running result, widened to the thumbnail's shape, on the paper color.

export const THUMB_WIDTH = 216, THUMB_HEIGHT = 56;
const CANVAS_WIDTH = 900, CANVAS_HEIGHT = 600;

/** The part of the 900×600 result to show (canvas pixels): the node's box with some room, in the thumbnail's shape, inside the canvas. */
export function thumbnailCrop(region: Region) {
  const aspect = THUMB_WIDTH / THUMB_HEIGHT, room = 1.24;
  const cx = (region.x + region.w / 2) * CANVAS_WIDTH, cy = (region.y + region.h / 2) * CANVAS_HEIGHT;
  let w = Math.max(24, region.w * CANVAS_WIDTH * room), h = Math.max(24, region.h * CANVAS_HEIGHT * room);
  if (w / h < aspect) w = h * aspect; else h = w / aspect;
  if (w > CANVAS_WIDTH) { w = CANVAS_WIDTH; h = w / aspect; }
  if (h > CANVAS_HEIGHT) { h = CANVAS_HEIGHT; w = h * aspect; }
  const clamp = (value: number, max: number) => Math.min(Math.max(0, value), max);
  return { x: clamp(cx - w / 2, CANVAS_WIDTH - w), y: clamp(cy - h / 2, CANVAS_HEIGHT - h), w, h };
}

/** Whether almost nothing is drawn (e.g. a brush that only draws after input): such a picture is not used. */
export function blank(alpha: Uint8ClampedArray) {
  let drawn = 0;
  for (let i = 3; i < alpha.length; i += 4) if (alpha[i] > 16) drawn++;
  return drawn < (alpha.length / 4) * .004;
}

/** The thumbnail (a small JPEG data URL) of a result image, or null when that part of it is empty. */
export async function captureThumbnail(image: string, region: Region): Promise<string | null> {
  const picture = new Image(); picture.src = image; await picture.decode();
  const scale = picture.naturalWidth / CANVAS_WIDTH, crop = thumbnailCrop(region);
  const canvas = document.createElement("canvas"); canvas.width = THUMB_WIDTH * 2; canvas.height = THUMB_HEIGHT * 2;
  const ctx = canvas.getContext("2d"); if (!ctx) return null;
  ctx.drawImage(picture, crop.x * scale, crop.y * scale, crop.w * scale, crop.h * scale, 0, 0, canvas.width, canvas.height);
  if (blank(ctx.getImageData(0, 0, canvas.width, canvas.height).data)) return null;
  ctx.globalCompositeOperation = "destination-over"; ctx.fillStyle = "#fffefa"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", .82);
}
