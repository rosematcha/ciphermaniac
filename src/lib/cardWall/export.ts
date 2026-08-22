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
import { buildMp4, type Mp4Sample } from './mp4';
import { buildScene, gifFrameDelayCs, type WallConfig, type WallDeal } from './scene';
import { type WallImages } from './images';
import { createWallPainter, type WallLook } from './render';

/** Frames sampled to build the global palette. The wall's colours barely move, so a few is plenty. */
const PALETTE_FRAMES = 8;
const PALETTE_SAMPLES_PER_FRAME = 8000;
/** Hand the event loop back this often, so the progress readout can repaint. */
const YIELD_EVERY = 3;

export interface ExportRequest {
  config: WallConfig;
  deal: WallDeal;
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
  const { config, deal, images, look, width, height, fps, onProgress, signal } = request;
  const { canvas, ctx } = createStage(width, height);
  const scene = buildScene(config, deal, canvas.width, canvas.height);
  const painter = createWallPainter();
  const frames = gifFrameCount(scene.loopSeconds, fps);
  const delayCs = gifFrameDelayCs(fps);
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
    writer.addFrame(quantizeFrame(pixels, palette, cache), delayCs);
    tick();
    if (i % YIELD_EVERY === 0) {
      await yieldToUi();
    }
  }

  const bytes = writer.finish();
  return { blob: new Blob([bytes as unknown as BlobPart], { type: 'image/gif' }), extension: 'gif' };
}

/**
 * H.264 profiles to try, best first: High 4.0, Main 4.0, then Baseline 3.0 for
 * anything that only implements the floor. All three decode everywhere that
 * matters; the difference is compression, not compatibility.
 */
const AVC_CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e01e'];

/** MP4 media timescale. 90kHz divides evenly by every frame rate offered. */
const MP4_TIMESCALE = 90_000;
/** A keyframe every couple of seconds, so scrubbing and looping stay responsive. */
const KEYFRAME_SECONDS = 2;

function videoBitrate(width: number, height: number, fps: number): number {
  return Math.min(24_000_000, Math.max(2_000_000, Math.round(width * height * fps * 0.15)));
}

/**
 * The first AVC config this browser will actually encode, or null if none.
 *
 * Checked against the real output size rather than a nominal one: a level that
 * covers 640x360 may refuse 1920x1080, and finding that out at `configure()`
 * time means failing after the user has already waited.
 */
export async function pickAvcCodec(width: number, height: number, fps: number): Promise<string | null> {
  if (typeof VideoEncoder === 'undefined') {
    return null;
  }
  for (const codec of AVC_CODECS) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate: videoBitrate(width, height, fps),
        framerate: fps,
        avc: { format: 'avc' }
      });
      if (support.supported) {
        return codec;
      }
    } catch {
      // An unparseable codec string throws rather than reporting unsupported.
    }
  }
  return null;
}

/** Recorder formats in preference order, for browsers with no usable AVC encoder. */
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

/**
 * What a video export will actually produce here, so the page can say so before
 * the user commits a minute to it rather than after.
 */
export async function describeVideoOutput(
  width: number,
  height: number,
  fps: number
): Promise<{ extension: 'mp4' | 'webm'; realtime: boolean } | null> {
  if (await pickAvcCodec(width, height, fps)) {
    return { extension: 'mp4', realtime: false };
  }
  const type = pickVideoType();
  return type ? { extension: videoExtension(type) as 'mp4' | 'webm', realtime: true } : null;
}

/** Let the encoder drain, and the page repaint, before queueing more frames. */
async function drain(encoder: VideoEncoder, limit: number): Promise<void> {
  while (encoder.encodeQueueSize > limit) {
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });
  }
}

/**
 * Encode the wall to MP4 with WebCodecs.
 *
 * Offline and frame-exact, like the GIF path: frame `i` is painted at a
 * computed time and handed to the encoder, so the export is reproducible and
 * finishes as fast as the machine allows instead of taking as long as the clip.
 */
async function encodeMp4(request: ExportRequest & { loops: number }, codec: string): Promise<ExportResult> {
  const { config, deal, images, look, width, height, fps, loops, onProgress, signal } = request;
  const { canvas, ctx } = createStage(width, height);
  const scene = buildScene(config, deal, canvas.width, canvas.height);
  const painter = createWallPainter();

  const perLoop = Math.max(2, Math.round(scene.loopSeconds * fps));
  const total = perLoop * Math.max(1, loops);
  const keyframeInterval = Math.max(1, Math.round(fps * KEYFRAME_SECONDS));

  const samples: Mp4Sample[] = [];
  let avcC: Uint8Array | null = null;
  let failure: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      const description = metadata?.decoderConfig?.description;
      if (!avcC && description) {
        // The spec allows either an ArrayBuffer or a view onto one; copy out of
        // whichever, because the buffer is only ours for the callback.
        avcC = ArrayBuffer.isView(description)
          ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength).slice()
          : new Uint8Array(description.slice(0));
      }
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push({ data, key: chunk.type === 'key' });
    },
    error: err => {
      failure = err instanceof Error ? err : new Error(String(err));
    }
  });

  try {
    encoder.configure({
      codec,
      width: canvas.width,
      height: canvas.height,
      bitrate: videoBitrate(canvas.width, canvas.height, fps),
      framerate: fps,
      avc: { format: 'avc' }
    });

    for (let i = 0; i < total; i++) {
      assertLive(signal);
      if (failure) {
        throw failure;
      }
      // Modulo the per-loop frame count rather than the wall clock, so every
      // repeat lands on exactly the same frames and the seam stays invisible.
      painter.paint(
        ctx,
        scene,
        images,
        ((i % perLoop) / perLoop) * scene.loopSeconds,
        canvas.width,
        canvas.height,
        look
      );
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((i * 1_000_000) / fps),
        duration: Math.round(1_000_000 / fps)
      });
      encoder.encode(frame, { keyFrame: i % keyframeInterval === 0 });
      frame.close();
      onProgress?.(i + 1, total);
      await drain(encoder, 8);
    }
    await encoder.flush();
  } finally {
    if (encoder.state !== 'closed') {
      encoder.close();
    }
  }

  if (failure) {
    throw failure;
  }
  if (!avcC) {
    throw new Error('The encoder produced no decoder configuration.');
  }
  const bytes = buildMp4({
    width: canvas.width,
    height: canvas.height,
    timescale: MP4_TIMESCALE,
    sampleDelta: Math.round(MP4_TIMESCALE / fps),
    samples,
    avcC
  });
  return { blob: new Blob([bytes as unknown as BlobPart], { type: 'video/mp4' }), extension: 'mp4' };
}

/**
 * Fallback capture for browsers with no AVC encoder — Firefox, today.
 *
 * MediaRecorder only records what a canvas actually displayed, so this one has
 * to animate in real time: a six-second clip takes six seconds to make.
 */
async function recordVideo(request: ExportRequest & { loops: number }): Promise<ExportResult> {
  const { config, deal, images, look, width, height, fps, loops, onProgress, signal } = request;
  const mimeType = pickVideoType();
  if (!mimeType) {
    throw new Error('This browser cannot encode or record video from a canvas.');
  }
  const { canvas, ctx } = createStage(width, height);
  const scene = buildScene(config, deal, canvas.width, canvas.height);
  const painter = createWallPainter();
  const duration = scene.loopSeconds * Math.max(1, loops);

  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: videoBitrate(canvas.width, canvas.height, fps)
  });
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

export async function exportVideo(request: ExportRequest & { loops: number }): Promise<ExportResult> {
  const codec = await pickAvcCodec(Math.round(request.width), Math.round(request.height), request.fps);
  return codec ? encodeMp4(request, codec) : recordVideo(request);
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
