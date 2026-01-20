type BreadcrumbItem = {
  name: string;
  url: string;
};

type PageSeoOptions = {
  title: string;
  description: string;
  canonicalPath: string;
  breadcrumbs?: BreadcrumbItem[];
  structuredData?: Record<string, unknown> | Array<Record<string, unknown>>;
};

const SITE_NAME = 'Ciphermaniac';

function setMetaTag(selector: string, value: string): void {
  const el = document.querySelector(selector) as HTMLMetaElement | null;
  if (el) {
    el.setAttribute('content', value);
  }
}

function setCanonicalUrl(url: string): void {
  let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.appendChild(link);
  }
  link.href = url;
}

function buildAbsoluteUrl(path: string): string {
  return new URL(path, window.location.origin).toString();
}

export function buildBreadcrumbList(items: BreadcrumbItem[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url
    }))
  };
}

export function buildWebPageSchema(title: string, description: string, url: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    description,
    url,
    isPartOf: {
      '@type': 'WebSite',
      name: SITE_NAME,
      url: window.location.origin
    }
  };
}

export function buildCardSchema(name: string, url: string, setId: string | null): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    category: 'Pokemon TCG Card',
    sku: setId || undefined,
    url,
    brand: {
      '@type': 'Brand',
      name: 'Pokemon'
    }
  };
}

export function applyPageSeo(options: PageSeoOptions): void {
  const canonicalUrl = buildAbsoluteUrl(options.canonicalPath);
  document.title = options.title;
  setCanonicalUrl(canonicalUrl);
  setMetaTag('meta[name="description"]', options.description);
  setMetaTag('meta[property="og:title"]', options.title);
  setMetaTag('meta[property="og:description"]', options.description);
  setMetaTag('meta[property="og:url"]', canonicalUrl);
  setMetaTag('meta[name="twitter:title"]', options.title);
  setMetaTag('meta[name="twitter:description"]', options.description);
  setMetaTag('meta[name="twitter:url"]', canonicalUrl);

  const structuredItems: Array<Record<string, unknown>> = [];
  if (options.structuredData) {
    if (Array.isArray(options.structuredData)) {
      structuredItems.push(...options.structuredData);
    } else {
      structuredItems.push(options.structuredData);
    }
  }
  if (options.breadcrumbs && options.breadcrumbs.length > 0) {
    structuredItems.push(buildBreadcrumbList(options.breadcrumbs));
  }

  if (structuredItems.length > 0) {
    let script = document.getElementById('structured-data') as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = 'structured-data';
      script.type = 'application/ld+json';
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(structuredItems.length === 1 ? structuredItems[0] : structuredItems);
  }
}
