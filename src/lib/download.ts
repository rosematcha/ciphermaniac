/**
 * Handing a finished export to the person who made it.
 *
 * A download link is the desktop answer and the wrong one on a phone: an
 * in-app browser has nowhere to put a download and navigates to the file
 * instead, which reads as the page reloading. There the file goes to the share
 * sheet, where "Save Image" lives.
 * @module lib/download
 */

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

/** Whether this browser can put the file on its share sheet. */
export function canShareFile(file: File): boolean {
  return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
}

/**
 * Offer the file through the share sheet. Resolves either way: declining the
 * sheet is not a failure of the export, and the caller has nothing to do about
 * a browser that refused.
 * @param file - What to share.
 */
export async function shareFile(file: File): Promise<void> {
  try {
    await navigator.share({ files: [file], title: file.name });
  } catch {
    // Cancelled, or refused by a browser whose canShare said yes.
  }
}

/**
 * A pointer that cannot hover and is not precise — a phone or a tablet, where
 * a download link is the wrong way to hand over a file.
 */
export function isTouchDevice(): boolean {
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}
