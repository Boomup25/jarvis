"use client";

/**
 * Prepare a photo for sending.
 *
 * Two sizes: one for the model (1280px is plenty — vision models downsample
 * anyway, and a raw phone photo is several megabytes of wasted upload), and a
 * small thumbnail that gets stored so the transcript still shows the picture.
 */
export interface PreparedImage {
  full: string;
  thumb: string;
  width: number;
  height: number;
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      // from-image respects EXIF rotation — without it, photos taken in
      // portrait arrive sideways.
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall through */
    }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const source = await loadBitmap(file);
  const sw = "width" in source ? source.width : 0;
  const sh = "height" in source ? source.height : 0;

  const render = (maxDim: number, quality: number) => {
    const scale = Math.min(1, maxDim / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  };

  const prepared = {
    full: render(1280, 0.82),
    thumb: render(320, 0.7),
    width: sw,
    height: sh,
  };

  if ("close" in source) source.close();
  return prepared;
}
