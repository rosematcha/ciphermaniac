/**
 * Placeholder art for each badge: a 16px line glyph drawn in the badge's
 * tier color. Stands in until the drawn art arrives; swapping it touches
 * this file alone.
 */

import type { JSX } from 'solid-js';
import type { Badge } from '../../../shared/accounts/achievements';

const GLYPHS: Record<Badge['key'], () => JSX.Element> = {
  played: () => (
    <>
      <rect x='4' y='2' width='8' height='12' rx='1.2' />
      <path d='M6 5h4' />
    </>
  ),
  won: () => <path d='M5 2h6v4a3 3 0 0 1-6 0zM5 3H3v1a2 2 0 0 0 2 2M11 3h2v1a2 2 0 0 1-2 2M8 9v3M5.5 14h5' />,
  organized: () => (
    <>
      <rect x='3.5' y='3' width='9' height='11' rx='1' />
      <path d='M6 2h4v2H6zM6 7.5h4M6 10.5h3' />
    </>
  ),
  staffed: () => (
    <>
      <path d='M5 1.5 8 5l3-3.5M6 12h4' />
      <rect x='4' y='5' width='8' height='9' rx='1' />
      <circle cx='8' cy='8.5' r='1.3' />
    </>
  ),
  traveler: () => (
    <>
      <path d='M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14z' />
      <circle cx='8' cy='6.5' r='1.6' />
    </>
  ),
  bug: () => (
    <>
      <ellipse cx='8' cy='9' rx='3.2' ry='4' />
      <path d='M8 5v8M4.8 8H2.5M13.5 8h-2.3M5 11.5l-2 1.5M11 11.5l2 1.5M6 3l1 2M10 3 9 5' />
    </>
  ),
  developer: () => <path d='M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3 7 13' />,
  creator: () => <path d='M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M8 4.5v7M4.5 8h7' />,
  beta: () => (
    <path d='M5.5 14V4.5a2.5 2.5 0 0 1 5 0c0 1.4-1 2.3-2.3 2.3 1.9 0 3.3 1 3.3 2.7S10.1 12 8.6 12c-1.2 0-2.1-.5-3.1-1.2' />
  ),
  early: () => <path d='M2 12h12M4.5 12a3.5 3.5 0 0 1 7 0M8 3v2.5M3.2 6.2l1.6 1.4M12.8 6.2l-1.6 1.4' />
};

export function BadgeArt(props: { badge: Badge['key'] }) {
  return (
    <svg
      class='tm-badge-art'
      width='18'
      height='18'
      viewBox='0 0 16 16'
      fill='none'
      stroke='currentColor'
      stroke-width='1.5'
      stroke-linecap='round'
      stroke-linejoin='round'
      aria-hidden='true'
    >
      {GLYPHS[props.badge]()}
    </svg>
  );
}
