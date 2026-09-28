import { encode } from 'uqr';

/**
 * A QR code for `text`. Always dark modules on a light ground, in dark mode
 * too: plenty of phone cameras will not read an inverted code, so this is the
 * one place the theme does not reach.
 */
export function QrCode(props: { text: string; label: string }) {
  const code = () => encode(props.text, { border: 2 });
  const path = () =>
    code()
      .data.flatMap((row, y) => row.flatMap((on, x) => (on ? [`M${x} ${y}h1v1h-1z`] : [])))
      .join('');
  return (
    <svg
      class='tm-qr'
      role='img'
      aria-label={props.label}
      viewBox={`0 0 ${code().size} ${code().size}`}
      shape-rendering='crispEdges'
    >
      <rect width='100%' height='100%' fill='#ffffff' />
      <path d={path()} fill='#000000' />
    </svg>
  );
}
