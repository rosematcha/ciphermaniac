import { logger } from '../../utils/logger.js';

export function attemptExecCommandCopy(text: string): boolean {
  if (!globalThis.document || typeof globalThis.document.createElement !== 'function') {
    return false;
  }
  if (!document.body) {
    return false;
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    document.body.appendChild(textarea);
    if (typeof textarea.focus === 'function') {
      textarea.focus();
    }
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  } catch (error) {
    logger.warn('execCommand clipboard copy failed', error);
    return false;
  }
}

export async function copyDecklistToClipboard(text: string): Promise<'clipboard' | 'execCommand' | 'prompt'> {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return 'clipboard';
    } catch (error) {
      logger.warn('navigator.clipboard.writeText failed, falling back', error);
    }
  }

  if (attemptExecCommandCopy(text)) {
    return 'execCommand';
  }

  const promptFn = typeof globalThis.window?.prompt === 'function' ? globalThis.window.prompt : null;
  if (promptFn) {
    const result = promptFn('Copy this TCG Live deck list:', text);
    if (result !== null) {
      return 'prompt';
    }
  }

  throw new Error('TCGLiveExportCopyCancelled');
}
