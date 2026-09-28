import { encode } from 'uqr';

/** A QR code for `text`, drawn in the current text colour so it follows the theme. */
export function QrCode(props: { text: string; size: number; label: string }) {
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
      width={props.size}
      height={props.size}
      viewBox={`0 0 ${code().size} ${code().size}`}
      shape-rendering='crispEdges'
    >
      <rect width='100%' height='100%' fill='var(--surface)' />
      <path d={path()} fill='currentColor' />
    </svg>
  );
}
