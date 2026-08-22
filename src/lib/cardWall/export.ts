/**
 * Turning the wall into a file.
 *
 * Two different jobs behind one idea. The GIF is rendered offline, frame by
 * frame, as fast as the machine manages — the loop is periodic, so the exact
 * frame times are known in advance and the result is bit-identical every run.
 * The video goes through MediaRecorder, which only records what a canvas
 * actually showed, so that path plays the animation at real speed and captures
 * it. A six-second video takes six seconds to make; a six-second GIF doesn't.
 * @module src/lib/cardWall/export
 */

import { buildPalette, createColorCache, createGifWriter, quantizeFrame, samplePixels } from './gif';
import { buildScene, planFrameDelays, type WallConfig } from './scene';
import { type WallImages } from './images';
import { createWallPainter, type WallLook } from './render';
import type { WallCard } from './roster';

/** Frames sampled to build the global palette. The wall's colours barely move, so a few is plenty. */
const PALETTE_FRAMES = 8;
const PALETTE_SAMPLES_PER_FRAME = 8000;
/** Hand the event loop back this often, so the progress readout can repaint. */
const YIELD_EVERY = 3;

export interface ExportRequest {
  config: WallConfig;
  roster: readonly WallCard[];
  images: WallImages;
  look: WallLook;
  width: number;
  height: number;
  fps: number;
  /** GIF colour table ceiling. Fewer colours is a much smaller file. */
  maxColors?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface ExportResult {
  blob: Blob;
  extension: string;
}

/** How many frames a GIF of this configuration will contain. */
export function gifFrameCount(loopSeconds: number, fps: number): number {
  return Math.max(2, Math.round(loopSeconds * fps));
}

function createStage(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Could not open a 2D canvas for export.');
  }
  return { canvas, ctx };
}

function yieldToUi(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

function assertLive(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException('Export cancelled', 'AbortError');
  }
}

export async function exportGif(request: ExportRequest): Promise<ExportResult> {
  const { config, roster, images, look, width, height, fps, onProgress, signal } = request;
  const { canvas, ctx } = createStage(width, height);
  const scene = buildScene(config, roster, canvas.width, canvas.height);
  const painter = createWallPainter();
  const frames = gifFrameCount(scene.loopSeconds, fps);
  const delays = planFrameDelays(scene.loopSeconds, frames);
  const frameTime = (i: number) => (i / frames) * scene.loopSeconds;
  // Progress covers both passes so the bar doesn't stall at the start.
  const total = Math.min(PALETTE_FRAMES, frames) + frames;
  let done = 0;
  const tick = () => {
    done += 1;
    onProgress?.(done, total);
  };

  const paletteFrames = Math.min(PALETTE_FRAMES, frames);
  const chunks: Uint8Array[] = [];
  let sampleLength = 0;
  for (let s = 0; s < paletteFrames; s++) {
    assertLive(signal);
    painter.paint(
      ctx,
      scene,
      images,
      frameTime(Math.floor((s * frames) / paletteFrames)),
      canvas.width,
      canvas.height,
      look
    );
    const chunk = samplePixels(ctx.getImageData(0, 0, canvas.width, canvas.height).data, PALETTE_SAMPLES_PER_FRAME);
    chunks.push(chunk);
    sampleLength += chunk.length;
    tick();
    await yieldToUi();
  }
  const samples = new Uint8Array(sampleLength);
  let at = 0;
  for (const chunk of chunks) {
    samples.set(chunk, at);
    at += chunk.length;
  }

  const palette = buildPalette(samples, request.maxColors ?? 256);
  const cache = createColorCache();
  const writer = createGifWriter(canvas.width, canvas.height, palette);
  for (let i = 0; i < frames; i++) {
    assertLive(signal);
    painter.paint(ctx, scene, images, frameTime(i), canvas.width, canvas.height, look);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    writer.addFrame(quantizeFrame(pixels, palette, cache), delays[i]!);
    tick();
    if (i % YIELD_EVERY === 0) {
      await yieldToUi();
    }
  }

  const bytes = writer.finish();
  return { blob: new Blob([bytes as unknown as BlobPart], { type: 'image/gif' }), extension: 'gif' };
}

/** Recorder formats in preference order: MP4 where the browser can, WebM where it can't. */
const VIDEO_TYPES = [
  'video/mp4;codecs=avc1.4d002a',
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm'
];

export function pickVideoType(): string | null {
  if (typeof MediaRecorder === 'undefined') {
    return null;
  }
  return VIDEO_TYPES.find(type => MediaRecorder.isTypeSupported(type)) ?? null;
}

/** File extension implied by a recorder MIME type. */
export function videoExtension(mimeType: string): string {
  return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
}

export async function exportVideo(request: ExportRequest & { loops: number }): Promise<ExportResult> {
  const { config, roster, images, look, width, height, fps, loops, onProgress, signal } = request;
  const mimeType = pickVideoType();
  if (!mimeType) {
    throw new Error('This browser cannot record video from a canvas.');
  }
  const { canvas, ctx } = createStage(width, height);
  const scene = buildScene(config, roster, canvas.width, canvas.height);
  const painter = createWallPainter();
  const duration = scene.loopSeconds * Math.max(1, loops);

  const stream = canvas.captureStream(fps);
  const bitrate = Math.min(24_000_000, Math.max(2_000_000, Math.round(canvas.width * canvas.height * fps * 0.15)));
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
  const parts: Blob[] = [];
  recorder.ondataavailable = event => {
    if (event.data.size > 0) {
      parts.push(event.data);
    }
  };
  const stopped = new Promise<void>(resolve => {
    recorder.onstop = () => resolve();
  });

  try {
    // Paint frame zero before the recorder starts, so the first captured frame
    // is the loop's first frame rather than an empty canvas.
    painter.paint(ctx, scene, images, 0, canvas.width, canvas.height, look);
    recorder.start();
    const startedAt = performance.now();
    await new Promise<void>((resolve, reject) => {
      let frame = 0;
      const step = () => {
        if (signal?.aborted) {
          reject(new DOMException('Export cancelled', 'AbortError'));
          return;
        }
        const elapsed = (performance.now() - startedAt) / 1000;
        if (elapsed >= duration) {
          resolve();
          return;
        }
        painter.paint(ctx, scene, images, elapsed % scene.loopSeconds, canvas.width, canvas.height, look);
        frame += 1;
        if (frame % 5 === 0) {
          onProgress?.(elapsed, duration);
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    recorder.stop();
    await stopped;
  } finally {
    // Cancelling has to reach the recorder too, or it keeps encoding a canvas
    // nobody is painting and holds the stream open for the rest of the session.
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
    stream.getTracks().forEach(track => track.stop());
  }

  onProgress?.(duration, duration);
  return { blob: new Blob(parts, { type: mimeType }), extension: videoExtension(mimeType) };
}

/**
 * Rough GIF size, from a measured 0.45 bytes per pixel at a 128-colour palette
 * on real card art. Only ever shown as an order of magnitude — the point is to
 * tell 4 MB apart from 40 MB before spending a minute encoding it.
 */
export function estimateGifBytes(frames: number, width: number, height: number, colors: number): number {
  const bytesPerPixel = colors >= 256 ? 0.55 : colors >= 128 ? 0.45 : 0.32;
  return Math.round(frames * width * height * bytesPerPixel);
}

/** Hand a finished export to the browser as a download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoking immediately can beat the download off the mark in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
