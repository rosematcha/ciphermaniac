/**
 * Parallel loading utilities for improved performance
 * @module ParallelLoader
 */

export interface ProgressIndicatorOptions {
  position?: 'fixed' | 'relative';
  location?: string;
  autoRemove?: boolean;
  showPercentage?: boolean;
  container?: HTMLElement | null;
}

export interface ProgressController {
  container: HTMLElement;
  steps: any[]; // Using any[] for stepElements as they have custom properties attached
  updateStep: (
    index: number,
    status: 'pending' | 'loading' | 'complete' | 'error' | 'warning',
    details?: string
  ) => void;
  updateProgress: (completed: number, total: number, details?: string) => void;
  remove: () => void;
  setComplete: (delayMs?: number) => void;
  fadeAndRemove: () => void;
}

/**
 * Creates a progress indicator for loading operations
 * @param title - Title for the progress indicator
 * @param steps - Array of step names
 * @param options - Configuration options
 * @returns Progress controller object
 */
export function createProgressIndicator(
  title: string,
  steps: string[],
  options: ProgressIndicatorOptions = {}
): ProgressController {
  const config = {
    position: 'fixed',
    location: 'top-right',
    autoRemove: true,
    showPercentage: true,
    container: null,
    ...options
  };

  const progressId = `progress-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

  const container = document.createElement('div');
  container.id = progressId;
  container.className = 'parallel-loader-progress';

  // Position styles
  const positionStyles: Record<string, string> =
    config.position === 'fixed'
      ? {
          position: 'fixed',
          top: config.location.includes('top') ? '20px' : 'auto',
          bottom: config.location.includes('bottom') ? '20px' : 'auto',
          left: config.location.includes('left') ? '20px' : 'auto',
          right: config.location.includes('right') ? '20px' : 'auto',
          zIndex: '10000'
        }
      : {
          position: 'relative',
          margin: '16px 0'
        };

  const positionCss = Object.entries(positionStyles)
    .map(([key, value]) => `${key}: ${value}`)
    .join('; ');

  container.style.cssText = `
    ${positionCss};
    background: var(--panel, #1a1f3a);
    border: 1px solid var(--border, #2c335a);
    border-radius: 8px;
    padding: 16px;
    min-width: 300px;
    max-width: 400px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    font-family: system-ui, sans-serif;
    color: var(--text, #ffffff);
  `;

  // Title
  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'font-weight: bold; margin-bottom: 12px; font-size: 14px;';
  titleEl.textContent = title;
  container.appendChild(titleEl);

  // Progress bar (if enabled)
  let progressBar: HTMLElement | null = null;
  let progressFill: HTMLElement | null = null;
  if (config.showPercentage) {
    progressBar = document.createElement('div');
    progressBar.style.cssText =
      'width: 100%; height: 4px; background: var(--bg-secondary, #0d1225); border-radius: 2px; overflow: hidden; margin-bottom: 12px;';

    progressFill = document.createElement('div');
    progressFill.style.cssText =
      'height: 100%; background: linear-gradient(90deg, #6aa3ff, #4d8bff); border-radius: 2px; transition: width 0.3s ease; width: 0%;';
    progressBar.appendChild(progressFill);
    container.appendChild(progressBar);
  }

  // Steps container
  const stepsContainer = document.createElement('div');
  stepsContainer.className = 'progress-steps';
  container.appendChild(stepsContainer);

  // Add spinner animation styles if not already present
  if (!document.getElementById('parallel-loader-styles')) {
    const styles = document.createElement('style');
    styles.id = 'parallel-loader-styles';
    styles.textContent = `
      @keyframes parallel-loader-spin { 
        from { transform: rotate(0deg); } 
        to { transform: rotate(360deg); } 
      }
    `;
    document.head.appendChild(styles);
  }

  // Create step elements
  const stepElements = steps.map(stepName => {
    const stepEl = document.createElement('div') as HTMLDivElement & {
      updateStatus: (status: string, details?: string) => void;
    };
    stepEl.className = 'progress-step';
    stepEl.style.cssText = 'display: flex; align-items: center; margin-bottom: 6px; font-size: 13px;';

    const icon = document.createElement('span');
    icon.className = 'step-icon';
    icon.style.cssText =
      'margin-right: 10px; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; font-size: 12px;';

    const label = document.createElement('span');
    label.className = 'step-label';
    label.textContent = stepName;

    const updateStatus = (status: string, details = '') => {
      switch (status) {
        case 'loading':
          icon.innerHTML = '⟳';
          icon.style.color = '#6aa3ff';
          icon.style.animation = 'parallel-loader-spin 1s linear infinite';
          stepEl.style.color = 'var(--text, #ffffff)';
          label.textContent = details || stepName;
          break;
        case 'complete':
          icon.innerHTML = '✓';
          icon.style.color = '#4CAF50';
          icon.style.animation = 'none';
          stepEl.style.color = 'var(--muted, #a3a8b7)';
          label.textContent = details || stepName;
          break;
        case 'error':
          icon.innerHTML = '✗';
          icon.style.color = '#f44336';
          icon.style.animation = 'none';
          stepEl.style.color = 'var(--muted, #a3a8b7)';
          label.textContent = details || stepName;
          break;
        case 'warning':
          icon.innerHTML = '⚠';
          icon.style.color = '#ff9800';
          icon.style.animation = 'none';
          stepEl.style.color = 'var(--muted, #a3a8b7)';
          label.textContent = details || stepName;
          break;
        default: // pending
          icon.innerHTML = '○';
          icon.style.color = 'var(--muted, #a3a8b7)';
          icon.style.animation = 'none';
          stepEl.style.color = 'var(--muted, #a3a8b7)';
          label.textContent = stepName;
      }
    };

    updateStatus('pending');
    stepEl.appendChild(icon);
    stepEl.appendChild(label);
    stepEl.updateStatus = updateStatus;
    stepsContainer.appendChild(stepEl);
    return stepEl;
  });

  const targetContainer = config.container || document.body;
  targetContainer.appendChild(container);

  let completedSteps = 0;
  const totalSteps = steps.length;

  const controller: ProgressController = {
    container,
    steps: stepElements,

    updateStep(index, status, details) {
      if (index >= 0 && index < stepElements.length) {
        const wasCompleted = stepElements[index].classList.contains('completed');
        stepElements[index].updateStatus(status, details);

        if (status === 'complete' && !wasCompleted) {
          stepElements[index].classList.add('completed');
          completedSteps++;
        }

        // Update progress bar
        if (progressFill && config.showPercentage) {
          const percentage = Math.round((completedSteps / totalSteps) * 100);
          progressFill.style.width = `${percentage}%`;
        }
      }
    },

    updateProgress(completed, total, details = '') {
      if (progressFill && config.showPercentage) {
        const percentage = Math.round((completed / total) * 100);
        progressFill.style.width = `${percentage}%`;

        if (details) {
          titleEl.textContent = `${title} - ${details}`;
        }
      }
    },

    remove() {
      if (container.parentNode) {
        container.remove();
      }
    },

    setComplete(delayMs = 1500) {
      // Setting progress complete with delay
      stepElements.forEach(step => {
        if (!step.classList.contains('completed')) {
          step.updateStatus('complete');
        }
      });

      if (config.autoRemove) {
        // Scheduling fade and remove
        setTimeout(() => {
          // Executing fadeAndRemove
          controller.fadeAndRemove();
        }, delayMs);
      }
    },

    fadeAndRemove() {
      // Starting fade and remove
      // Add fade-out transition
      container.style.transition = 'opacity 0.3s ease-out';
      container.style.opacity = '0';

      // Remove after fade completes
      setTimeout(() => {
        // Removing from DOM
        if (container.parentNode) {
          container.remove();
          // Successfully removed
        } else {
          // Already removed from DOM
        }
      }, 300);
    }
  };

  return controller;
}

/**
 * Cleanup utility to remove any orphaned progress indicators
 * Call this if you suspect progress indicators are not being cleaned up properly
 */
export function cleanupOrphanedProgressDisplay(): number {
  const orphanedElements = document.querySelectorAll('.parallel-loader-progress');
  let cleaned = 0;

  orphanedElements.forEach(element => {
    // Add fade-out and remove
    (element as HTMLElement).style.transition = 'opacity 0.3s ease-out';
    (element as HTMLElement).style.opacity = '0';

    setTimeout(() => {
      if (element.parentNode) {
        element.remove();
        cleaned++;
      }
    }, 300);
  });

  if (cleaned > 0) {
    // Cleaned up orphaned progress indicators
  }

  return cleaned;
}

export interface ProcessInParallelOptions<T, R> {
  concurrency?: number;
  onProgress?: ((processed: number, total: number, item: T, result: R | null, error?: any) => void) | null;
  onError?: 'continue' | 'stop' | 'retry';
  retryAttempts?: number;
  retryDelay?: number;
}

/**
 * Parallel batch processor with concurrency control
 * @param items - Items to process
 * @param processor - Function to process each item
 * @param options - Configuration options
 * @returns Results array
 */
export async function processInParallel<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  options: ProcessInParallelOptions<T, R> = {}
): Promise<(R | null)[]> {
  const config = {
    concurrency: 6,
    onProgress: null,
    onError: 'continue', // 'continue', 'stop', 'retry'
    retryAttempts: 2,
    retryDelay: 1000,
    ...options
  };

  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const results: (R | null)[] = [];
  let processed = 0;

  // Create chunks based on concurrency limit
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += config.concurrency) {
    chunks.push(items.slice(i, i + config.concurrency));
  }

  for (const chunk of chunks) {
    // eslint-disable-next-line no-loop-func -- closure captures processed for progress tracking
    const promises = chunk.map((item, chunkIndex) => {
      const globalIndex = chunks.indexOf(chunk) * config.concurrency + chunkIndex;

      const processWithRetry = async (attempts = 0): Promise<R | null | undefined> => {
        try {
          const result = await processor(item, globalIndex);
          processed++;

          if (config.onProgress) {
            config.onProgress(processed, items.length, item, result);
          }

          return result;
        } catch (error) {
          if (attempts < config.retryAttempts && config.onError !== 'stop') {
            await new Promise(resolve => {
              setTimeout(resolve, config.retryDelay);
            });
            return processWithRetry(attempts + 1);
          }

          if (config.onError === 'stop') {
            throw error;
          }

          processed++;
          if (config.onProgress) {
            config.onProgress(processed, items.length, item, null, error);
          }

          return config.onError === 'continue' ? null : undefined;
        }
      };

      return processWithRetry();
    });

    const chunkResults = await Promise.all(promises);
    // Filter out undefined if any (from onError !== 'continue' which returns undefined?)
    // Actually processWithRetry returns null for continue.
    results.push(...(chunkResults as (R | null)[]));
  }

  return results;
}

export interface ProcessBatchedOptions<T, R> {
  batchSize?: number;
  batchDelay?: number;
  onProgress?: ((processed: number, total: number, item: T, result: R | null, error?: any) => void) | null;
  onBatchComplete?: ((batchIndex: number, totalBatches: number, results: (R | null)[]) => void) | null;
}

/**
 * Batched sequential processor with progress tracking
 * @param items - Items to process
 * @param processor - Function to process each item
 * @param options - Configuration options
 * @returns Results array
 */
export async function processBatched<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  options: ProcessBatchedOptions<T, R> = {}
): Promise<(R | null)[]> {
  const config = {
    batchSize: 4,
    batchDelay: 100,
    onProgress: null,
    onBatchComplete: null,
    ...options
  };

  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const results: (R | null)[] = [];
  let processed = 0;

  // Create batches
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += config.batchSize) {
    batches.push(items.slice(i, i + config.batchSize));
  }

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const batchResults: (R | null)[] = [];

    for (let itemIndex = 0; itemIndex < batch.length; itemIndex++) {
      const item = batch[itemIndex];
      const globalIndex = batchIndex * config.batchSize + itemIndex;

      try {
        const result = await processor(item, globalIndex);
        batchResults.push(result);
        processed++;

        if (config.onProgress) {
          config.onProgress(processed, items.length, item, result);
        }
      } catch (error) {
        batchResults.push(null);
        processed++;

        if (config.onProgress) {
          config.onProgress(processed, items.length, item, null, error);
        }
      }
    }

    results.push(...batchResults);

    if (config.onBatchComplete) {
      config.onBatchComplete(batchIndex + 1, batches.length, batchResults);
    }

    // Delay between batches (except for the last one)
    if (batchIndex < batches.length - 1 && config.batchDelay > 0) {
      await new Promise(resolve => {
        setTimeout(resolve, config.batchDelay);
      });
    }
  }

  return results;
}

export interface LoadWithCacheOptions<T, R> {
  concurrency?: number;
  onProgress?: ((processed: number, total: number, item: T, result: R | null, error?: any) => void) | null;
  onCacheHit?: ((item: T, result: R) => void) | null;
  onCacheMiss?: ((item: T, result: R) => void) | null;
  saveCache?: (() => void) | null;
}

/**
 * Cache-aware parallel loader with progress tracking
 * @param items - Items to load
 * @param loader - Function to load each item
 * @param cache - Cache object
 * @param cacheKey - Function to generate cache key for item
 * @param options - Configuration options
 * @returns Results array
 */
export async function loadWithCache<T, R>(
  items: T[],
  loader: (item: T, index: number) => Promise<R>,
  cache: Record<string, R>,
  cacheKey: (item: T) => string,
  options: LoadWithCacheOptions<T, R> = {}
): Promise<R[]> {
  const config = {
    concurrency: 6,
    onProgress: null,
    onCacheHit: null,
    onCacheMiss: null,
    saveCache: null,
    ...options
  };

  const results: { item: T; result: R; fromCache: boolean }[] = [];
  const uncachedItems: T[] = [];
  const cacheHits: T[] = [];

  // Check cache for all items first
  for (const item of items) {
    const key = cacheKey(item);
    if (cache[key]) {
      results.push({ item, result: cache[key], fromCache: true });
      cacheHits.push(item);

      if (config.onCacheHit) {
        config.onCacheHit(item, cache[key]);
      }
    } else {
      uncachedItems.push(item);
    }
  }

  if (uncachedItems.length === 0) {
    return results.map(result => result.result);
  }

  // Load uncached items in parallel
  const uncachedResults = await processInParallel(
    uncachedItems,
    async (item, index) => {
      try {
        const result = await loader(item, index);
        const key = cacheKey(item);
        cache[key] = result;

        if (config.onCacheMiss) {
          config.onCacheMiss(item, result);
        }

        return { item, result, fromCache: false };
      } catch (error) {
        if (config.onProgress) {
          config.onProgress(cacheHits.length + index + 1, items.length, item, null, error);
        }
        throw error;
      }
    },
    {
      concurrency: config.concurrency,
      onProgress: config.onProgress
        ? (processed, total, item, result) => {
            config.onProgress!(cacheHits.length + processed, items.length, item, result as any);
          }
        : null
    }
  );

  // Save cache if function provided
  if (config.saveCache && uncachedResults.some(resultItem => resultItem !== null)) {
    try {
      config.saveCache();
    } catch {
      // Failed to save cache
    }
  }

  // Merge results maintaining original order
  const allResults = [
    ...results,
    ...(uncachedResults.filter(resultItem => resultItem !== null) as { item: T; result: R; fromCache: boolean }[])
  ];

  // Sort back to original order
  const itemIndexMap = new Map(items.map((item, itemIndex) => [item, itemIndex]));
  allResults.sort((resultA, resultB) => (itemIndexMap.get(resultA.item) || 0) - (itemIndexMap.get(resultB.item) || 0));

  return allResults.map(resultItem => resultItem.result);
}
