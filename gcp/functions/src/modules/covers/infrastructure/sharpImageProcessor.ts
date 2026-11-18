import { createHash } from "node:crypto";
import sharp from "sharp";
import { PixabayUnavailableError, type DownloadedImage, type ImageProcessor, type ProcessedCover } from "../application/livePorts";

const LIMIT_INPUT_PIXELS = 40_000_000;
const MIN_WIDTH = 960;
const MIN_HEIGHT = 600;
const MIN_RATIO = 1.3;
const MAX_RATIO = 2.2;
const WEBP_QUALITIES = [78, 72, 66, 60, 55, 50];
const JPEG_QUALITIES = [80, 72, 65, 58, 50];
const WEBP_MAX_BYTES = 200 * 1024;
const JPEG_MAX_BYTES = 150 * 1024;

const open = (bytes: Buffer) => sharp(bytes, { limitInputPixels: LIMIT_INPUT_PIXELS, failOn: "error" });

/** 64-bit difference hash of a 9x8 greyscale thumbnail as 16 hex characters (same algorithm as scripts/covers/pixabay.ts). */
export async function differenceHash(bytes: Buffer): Promise<string> {
  const px = await open(bytes).rotate().resize(9, 8, { fit: "fill" }).greyscale().raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | ((px[y * 9 + x] ?? 0) < (px[y * 9 + x + 1] ?? 0) ? 1n : 0n);
  return bits.toString(16).padStart(16, "0");
}

export class SharpImageProcessor implements ImageProcessor {
  async process(source: DownloadedImage): Promise<ProcessedCover> {
    let width: number;
    let height: number;
    try {
      const meta = await open(source.bytes).metadata();
      const swap = (meta.orientation ?? 1) >= 5;
      width = (swap ? meta.height : meta.width) ?? 0;
      height = (swap ? meta.width : meta.height) ?? 0;
    } catch {
      throw new PixabayUnavailableError("image_invalid");
    }
    if (width <= 0 || height <= 0) throw new PixabayUnavailableError("image_invalid");
    if (width < MIN_WIDTH || height < MIN_HEIGHT) throw new PixabayUnavailableError("image_too_small");
    const ratio = width / height;
    if (ratio < MIN_RATIO || ratio > MAX_RATIO) throw new PixabayUnavailableError("image_aspect");

    try {
      let webp: Buffer = Buffer.alloc(0);
      for (const quality of WEBP_QUALITIES) {
        webp = await open(source.bytes).rotate().resize(1200, 750, { fit: "cover", position: "attention" }).webp({ quality }).toBuffer();
        if (webp.length <= WEBP_MAX_BYTES) break;
      }
      let jpeg: Buffer = Buffer.alloc(0);
      for (const quality of JPEG_QUALITIES) {
        jpeg = await open(source.bytes).rotate().resize(960, 600, { fit: "cover", position: "attention" }).jpeg({ quality, mozjpeg: true }).toBuffer();
        if (jpeg.length <= JPEG_MAX_BYTES) break;
      }
      return { webp, jpeg, width: 1200, height: 750, dHash: await differenceHash(source.bytes), sha256: createHash("sha256").update(webp).digest("hex") };
    } catch {
      throw new PixabayUnavailableError("image_invalid");
    }
  }
}
