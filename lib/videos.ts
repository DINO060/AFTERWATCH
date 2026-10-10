// Short videos for community posts (one per post, with or without photos), checked in the browser
// before anything is sent: MP4 (H.264)
// or WebM, at most 2 minutes and 100 MB. iPhone videos in HEVC are refused because most computers
// cannot play them. A preview image is taken from the video so the video itself only downloads
// when someone presses play. The video is sent in 6 MB pieces (Supabase's resumable upload), so a
// weak phone connection resumes instead of starting over, and the progress can be shown.
// Browser only.
import * as tus from 'tus-js-client';
import { PHOTO_BUCKET, VIDEO_BUCKET, VIDEO_MAX_BYTES, VIDEO_MAX_SECONDS, type Video } from './community';
import type { PreparedPhoto } from './photos';
import { createSupabaseBrowserClient } from './supabase/browser';
import { getSupabaseConfig } from './supabase/config';
import { mp4Formats } from './mp4';

export type PreparedVideo = {
  file: File;
  ext: 'mp4' | 'webm';
  w: number;
  h: number;
  duration: number;
  poster: PreparedPhoto;
  preview: string;
};
export class VideoFailure extends Error {
  key: 'notVideo' | 'tooBig' | 'tooLong' | 'hevc' | 'unreadable' | 'upload';
  constructor(key: VideoFailure['key']) {
    super(key);
    this.key = key;
  }
}

const HEVC = new Set(['hvc1', 'hev1', 'dvh1', 'dvhe']);

const waitFor = (target: HTMLVideoElement, event: string, ms: number) =>
  new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new VideoFailure('unreadable')), ms);
    target.addEventListener(
      event,
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    target.addEventListener('error', () => reject(new VideoFailure('unreadable')), { once: true });
  });

const encode = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

export async function prepareVideo(file: File): Promise<PreparedVideo> {
  const lower = file.name.toLowerCase();
  const webm = file.type === 'video/webm' || lower.endsWith('.webm');
  const mp4 =
    ['video/mp4', 'video/quicktime', 'video/x-m4v'].includes(file.type) || /\.(mp4|m4v|mov)$/.test(lower);
  if (!webm && !mp4) throw new VideoFailure('notVideo');
  if (file.size > VIDEO_MAX_BYTES) throw new VideoFailure('tooBig');
  if (mp4) {
    const formats = mp4Formats(new DataView(await file.arrayBuffer()));
    if (formats.some((f) => HEVC.has(f))) throw new VideoFailure('hevc');
  }
  const preview = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = preview;
  try {
    await waitFor(video, 'loadedmetadata', 15000);
    const { duration, videoWidth: w, videoHeight: h } = video;
    if (!w || !h || !Number.isFinite(duration)) throw new VideoFailure('unreadable');
    if (duration > VIDEO_MAX_SECONDS + 0.5) throw new VideoFailure('tooLong');
    // The preview image: a frame near the start, at most 960 px wide.
    video.currentTime = Math.min(0.5, duration / 2);
    await waitFor(video, 'seeked', 10000);
    const scale = Math.min(1, 960 / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    let blob = await encode(canvas, 'image/webp', 0.8);
    let ext: PreparedPhoto['ext'] = 'webp';
    if (!blob || blob.type !== 'image/webp') {
      blob = await encode(canvas, 'image/jpeg', 0.82);
      ext = 'jpg';
    }
    if (!blob) throw new VideoFailure('unreadable');
    return {
      file,
      ext: webm ? 'webm' : 'mp4',
      w,
      h,
      duration: Math.round(duration * 10) / 10,
      poster: { blob, w: canvas.width, h: canvas.height, ext, preview: URL.createObjectURL(blob) },
      preview,
    };
  } catch (e) {
    URL.revokeObjectURL(preview);
    throw e instanceof VideoFailure ? e : new VideoFailure('unreadable');
  }
}

/** Sends the video in 6 MB pieces, resuming after a dropped connection; reports from 0 to 1. */
function sendResumable(
  file: File,
  path: string,
  token: string,
  url: string,
  onProgress?: (share: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${url.replace(/\/+$/, '')}/storage/v1/upload/resumable`,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      headers: { authorization: `Bearer ${token}`, 'x-upsert': 'false' },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: VIDEO_BUCKET,
        objectName: path,
        contentType: file.name.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4',
        cacheControl: '31536000',
      },
      // Supabase needs exactly 6 MB per piece.
      chunkSize: 6 * 1024 * 1024,
      onError: () => reject(new VideoFailure('upload')),
      onProgress: (sent, total) => onProgress?.(total ? sent / total : 0),
      onSuccess: () => resolve(),
    });
    upload.start();
  });
}

/** Sends the preview image, then the video; if one fails, the other is removed again. */
export async function uploadVideo(
  userId: string,
  prepared: PreparedVideo,
  onProgress?: (share: number) => void,
): Promise<Video> {
  const supabase = createSupabaseBrowserClient();
  const config = getSupabaseConfig();
  if (!supabase || !config) throw new VideoFailure('upload');
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new VideoFailure('upload');
  const poster = `${userId}/${crypto.randomUUID()}.${prepared.poster.ext}`;
  const path = `${userId}/${crypto.randomUUID()}.${prepared.ext}`;
  const photos = supabase.storage.from(PHOTO_BUCKET);
  const sentPoster = await photos.upload(poster, prepared.poster.blob, {
    contentType: prepared.poster.ext === 'webp' ? 'image/webp' : 'image/jpeg',
    cacheControl: '31536000',
    upsert: false,
  });
  if (sentPoster.error) throw new VideoFailure('upload');
  try {
    // A renamed copy, so the type sent matches the name (a .mov in H.264 is sent as MP4).
    const file = new File([prepared.file], path.split('/')[1], {
      type: prepared.ext === 'webm' ? 'video/webm' : 'video/mp4',
    });
    await sendResumable(file, path, token, config.url, onProgress);
  } catch {
    await photos.remove([poster]).catch(() => {});
    throw new VideoFailure('upload');
  }
  return { path, poster, w: prepared.w, h: prepared.h, duration: prepared.duration };
}

/** Removes a video and its preview that were sent but did not end up in a post. */
export async function discardVideo(video: Video | null) {
  if (!video) return;
  const supabase = createSupabaseBrowserClient();
  await Promise.all([
    supabase?.storage
      .from(VIDEO_BUCKET)
      .remove([video.path])
      .catch(() => {}),
    supabase?.storage
      .from(PHOTO_BUCKET)
      .remove([video.poster])
      .catch(() => {}),
  ]);
}
