import { BRAND } from './brand';

/** The fake site's own footer, under the page, above Ciphermaniac's. */
export function SiteFooter() {
  return (
    <footer class='regsim-footer'>
      <p>
        <span>{BRAND} Support Center</span> | <span>Privacy Notice</span> | <span>Terms of Service</span>
      </p>
      <p>
        &copy; Copyright {new Date().getFullYear()} {BRAND}
      </p>
    </footer>
  );
}
