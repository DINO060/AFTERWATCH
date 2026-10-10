// Photos for community posts, prepared in the browser: drawn again at most 1600 px wide and saved
// as WebP (JPEG where the browser cannot), which also drops the camera data such as the GPS
// location. Then sent to the member's own folder of the photo bucket. Browser only.
import { AVATAR_BUCKET, PHOTO_BUCKET, type Photo } from './community';
import { createSupabaseBrowserClient } from './supabase/browser';

const MAX_SIDE = 1600;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_INPUT = 30 * 1024 * 1024;

export type PreparedPhoto = { blob: Blob; w: number; h: number; ext: 'webp' | 'jpg'; preview: string };
export class PhotoFailure extends Error {
  key: 'notImage' | 'tooBig' | 'unreadable' | 'upload';
  constructor(key: PhotoFailure['key']) {
    super(key);
    this.key = key;
  }
}

const encode = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!file.type.startsWith('image/')) throw new PhotoFailure('notImage');
  if (file.size > MAX_INPUT) throw new PhotoFailure('tooBig');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoFailure('unreadable');
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext('2d');
  if (!context) throw new PhotoFailure('unreadable');
  context.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  let blob = await encode(canvas, 'image/webp', 0.82);
  let ext: PreparedPhoto['ext'] = 'webp';
  // Some browsers fall back to PNG when they cannot write WebP.
  if (!blob || blob.type !== 'image/webp') {
    blob = await encode(canvas, 'image/jpeg', 0.85);
    ext = 'jpg';
  }
  if (blob && blob.size > MAX_BYTES) {
    blob = await encode(canvas, 'image/jpeg', 0.7);
    ext = 'jpg';
  }
  if (!blob || blob.size > MAX_BYTES) throw new PhotoFailure('tooBig');
  return { blob, w, h, ext, preview: URL.createObjectURL(blob) };
}

/** Sends prepared photos; if one fails, the others already sent are removed again. */
export async function uploadPhotos(userId: string, photos: PreparedPhoto[]): Promise<Photo[]> {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) throw new PhotoFailure('upload');
  const bucket = supabase.storage.from(PHOTO_BUCKET);
  const sent: Photo[] = [];
  try {
    for (const p of photos) {
      const path = `${userId}/${crypto.randomUUID()}.${p.ext}`;
      const { error } = await bucket.upload(path, p.blob, {
        contentType: p.ext === 'webp' ? 'image/webp' : 'image/jpeg',
        cacheControl: '31536000',
        upsert: false,
      });
      if (error) throw new PhotoFailure('upload');
      sent.push({ path, w: p.w, h: p.h });
    }
    return sent;
  } catch (e) {
    await discardPhotos(sent.map((p) => p.path));
    throw e instanceof PhotoFailure ? e : new PhotoFailure('upload');
  }
}

/** Removes photos that were sent but did not end up in a post. */
export async function discardPhotos(paths: string[]) {
  if (!paths.length) return;
  await createSupabaseBrowserClient()
    ?.storage.from(PHOTO_BUCKET)
    .remove(paths)
    .catch(() => {});
}

/** A profile photo: the centre of the picture, cropped to a 256 px square. */
export async function prepareAvatar(file: File): Promise<PreparedPhoto> {
  if (!file.type.startsWith('image/')) throw new PhotoFailure('notImage');
  if (file.size > MAX_INPUT) throw new PhotoFailure('tooBig');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PhotoFailure('unreadable');
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new PhotoFailure('unreadable');
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    256,
    256,
  );
  bitmap.close();
  let blob = await encode(canvas, 'image/webp', 0.85);
  let ext: PreparedPhoto['ext'] = 'webp';
  if (!blob || blob.type !== 'image/webp') {
    blob = await encode(canvas, 'image/jpeg', 0.88);
    ext = 'jpg';
  }
  if (!blob) throw new PhotoFailure('unreadable');
  return { blob, w: 256, h: 256, ext, preview: URL.createObjectURL(blob) };
}

/** Sends a profile photo to the member's own folder; the server then records it. */
export async function uploadAvatar(userId: string, photo: PreparedPhoto): Promise<string> {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) throw new PhotoFailure('upload');
  const path = `${userId}/${crypto.randomUUID()}.${photo.ext}`;
  const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, photo.blob, {
    contentType: photo.ext === 'webp' ? 'image/webp' : 'image/jpeg',
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw new PhotoFailure('upload');
  return path;
}

/** Removes a profile photo that was sent but could not be recorded. */
export async function discardAvatar(path: string) {
  await createSupabaseBrowserClient()
    ?.storage.from(AVATAR_BUCKET)
    .remove([path])
    .catch(() => {});
}
