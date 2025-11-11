/**
 * Parallel loading utilities for improved performance
 * @module ParallelLoader
 */

/**
 * Creates a progress indicator for loading operations
 * @param {string} title - Title for the progress indicator
 * @param {Array<string>} steps - Array of step names
 * @param {object} options - Configuration options
 * @returns {object} Progress controller object
 */
export function createProgressIndicator(title, steps, options = {}) {
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
  const positionStyles =
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
  let progressBar = null;
  let progressFill = null;
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
    const stepEl = document.createElement('div');
    stepEl.className = 'progress-step';
    stepEl.style.cssText = 'display: flex; align-items: center; margin-bottom: 6px; font-size: 13px;';

    const icon = document.createElement('span');
    icon.className = 'step-icon';
    icon.style.cssText =
      'margin-right: 10px; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; font-size: 12px;';

    const label = document.createElement('span');
    label.className = 'step-label';
    label.textContent = stepName;

    const updateStatus = (status, details = '') => {
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

  const controller = {
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
export function cleanupOrphanedProgressDisplay() {
  const orphanedElements = document.querySelectorAll('.parallel-loader-progress');
  let cleaned = 0;

  orphanedElements.forEach(element => {
    // Add fade-out and remove
    element.style.transition = 'opacity 0.3s ease-out';
    element.style.opacity = '0';

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

/**
 * Parallel batch processor with concurrency control
 * @param {Array} items - Items to process
 * @param {Function} processor - Function to process each item
 * @param {object} options - Configuration options
 * @returns {Promise<Array>} Results array
 */
export async function processInParallel(items, processor, options = {}) {
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

  const results = [];
  let processed = 0;

  // Create chunks based on concurrency limit
  const chunks = [];
  for (let i = 0; i < items.length; i += config.concurrency) {
    chunks.push(items.slice(i, i + config.concurrency));
  }

  for (const chunk of chunks) {
    // eslint-disable-next-line no-loop-func
    const promises = chunk.map((item, chunkIndex) => {
      const globalIndex = chunks.indexOf(chunk) * config.concurrency + chunkIndex;

      const processWithRetry = async (attempts = 0) => {
        try {
          const result = await processor(item, globalIndex);
          processed++;

          if (config.onProgress) {
            config.onProgress(processed, items.length, item, result);
          }

          return result;
        } catch (error) {
          if (attempts < config.retryAttempts && config.onError !== 'stop') {
            await new Promise(resolve => setTimeout(resolve, config.retryDelay));
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
    results.push(...chunkResults);
  }

  return results;
}

/**
 * Batched sequential processor with progress tracking
 * @param {Array} items - Items to process
 * @param {Function} processor - Function to process each item
 * @param {object} options - Configuration options
 * @returns {Promise<Array>} Results array
 */
export async function processBatched(items, processor, options = {}) {
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

  const results = [];
  let processed = 0;

  // Create batches
  const batches = [];
  for (let i = 0; i < items.length; i += config.batchSize) {
    batches.push(items.slice(i, i + config.batchSize));
  }

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const batchResults = [];

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
      await new Promise(resolve => setTimeout(resolve, config.batchDelay));
    }
  }

  return results;
}

/**
 * Cache-aware parallel loader with progress tracking
 * @param {Array} items - Items to load
 * @param {Function} loader - Function to load each item
 * @param {object} cache - Cache object
 * @param {Function} cacheKey - Function to generate cache key for item
 * @param {object} options - Configuration options
 * @returns {Promise<Array>} Results array
 */
export async function loadWithCache(items, loader, cache, cacheKey, options = {}) {
  const config = {
    concurrency: 6,
    onProgress: null,
    onCacheHit: null,
    onCacheMiss: null,
    saveCache: null,
    ...options
  };

  const results = [];
  const uncachedItems = [];
  const cacheHits = [];

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
        // eslint-disable-next-line no-param-reassign
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
          config.onProgress(cacheHits.length + processed, items.length, item, result);
        }
        : null
    }
  );

  // Save cache if function provided
  if (config.saveCache && uncachedResults.some(resultItem => resultItem !== null)) {
    try {
      config.saveCache();
    } catch (error) {
      // Failed to save cache
    }
  }

  // Merge results maintaining original order
  const allResults = [...results, ...uncachedResults.filter(resultItem => resultItem !== null)];

  // Sort back to original order
  const itemIndexMap = new Map(items.map((item, itemIndex) => [item, itemIndex]));
  allResults.sort((resultA, resultB) => itemIndexMap.get(resultA.item) - itemIndexMap.get(resultB.item));

  return allResults.map(resultItem => resultItem.result);
}
