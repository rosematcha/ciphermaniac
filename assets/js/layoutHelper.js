import { GAP, BASE, MIN_BASE, BIG_ROWS, MIN_SCALE } from './layoutConfig.js';

// Compute layout metrics for a given container width
export function computeLayout(containerWidth){
  const gap = GAP;
  let base = BASE;
  if(containerWidth > 0){
    const targetBaseForTwo = Math.floor(((containerWidth + gap) / 2) - gap);
    if(targetBaseForTwo >= MIN_BASE){
      base = Math.min(BASE, targetBaseForTwo);
    } else {
      base = BASE;
    }
  }
  const cardOuter = base + gap;
  const perRowBig = Math.max(1, Math.floor((containerWidth + gap) / cardOuter));
  const bigRowContentWidth = perRowBig * base + Math.max(0, perRowBig - 1) * gap;
  let targetSmall = Math.max(1, perRowBig + 1);
  const rawScale = (((bigRowContentWidth + gap) / targetSmall) - gap) / base;
  let smallScale;
  if(rawScale < MIN_SCALE){
    targetSmall = perRowBig;
    smallScale = 1;
  } else {
    smallScale = Math.min(1, rawScale);
  }
  return { gap, base, perRowBig, bigRowContentWidth, targetSmall, smallScale, bigRows: BIG_ROWS };
}

// Keep header controls width synced to big row content width (desktop only; CSS overrides on mobile)
export function syncControlsWidth(width){
  // Prefer toolbar controls if present (toolbar was added to separate header from filters)
  const controls = document.querySelector('.toolbar .controls') || document.querySelector('.controls');
  if(!controls) return;
  // On small screens, let CSS handle width (mobile override)
  if(window.innerWidth <= 520){
    controls.style.width = '';
    controls.style.margin = '';
    return;
  }
  // If there's a header-inner with a max width, cap controls width to that to avoid excessively wide controls
  const headerInner = document.querySelector('.header-inner');
  const cap = headerInner ? headerInner.clientWidth : width;
  const finalWidth = Math.min(width, cap || width);
  controls.style.width = finalWidth + 'px';
  controls.style.margin = '0 auto';
}
