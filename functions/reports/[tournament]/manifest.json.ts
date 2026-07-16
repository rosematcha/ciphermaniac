import { jsonError } from '../../lib/api/responses.js';

interface RequestContext {
  request: Request;
  params: {
    tournament?: string;
  };
}

interface AssetProbe {
  ok: boolean;
  bytes: number;
  updatedAt: string;
  /**
   * True when every probe attempt failed with a server-side error (5xx) or a
   * network/transport failure — i.e. we could not determine whether the asset
   * exists. Distinct from a clean 404 (asset genuinely absent), where this is
   * false.
   */
  serverError: boolean;
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=3600'
} as const;

function encodeTournament(rawTournament: string | undefined): string {
  return encodeURIComponent(String(rawTournament || '').trim());
}

function parseBytes(headers: Headers): number {
  const raw = headers.get('content-length');
  const numeric = Number(raw);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function parseUpdatedAt(headers: Headers): string {
  return headers.get('last-modified') || headers.get('date') || new Date().toISOString();
}

async function probeAsset(urls: string[]): Promise<AssetProbe> {
  // Track whether we ever got an unambiguous "absent" (404) signal. If we only
  // ever saw 5xx / network failures, the asset's existence is unknown and the
  // caller must not report it as missing.
  let sawDefinitiveAbsence = false;
  let sawServerError = false;

  for (const url of urls) {
    const response = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (!response) {
      // Network / transport failure — indistinguishable from an outage.
      sawServerError = true;
      continue;
    }
    if (response.ok) {
      return {
        ok: true,
        bytes: parseBytes(response.headers),
        updatedAt: parseUpdatedAt(response.headers),
        serverError: false
      };
    }
    if (response.status >= 500) {
      sawServerError = true;
    } else {
      // 404 and other 4xx: the origin answered and the asset is not there.
      sawDefinitiveAbsence = true;
    }
  }

  return {
    ok: false,
    bytes: 0,
    updatedAt: '',
    // Only surface a server error if we never got a definitive absence from any
    // mirror. If one mirror said 404 while another 5xx'd, trust the 404.
    serverError: sawServerError && !sawDefinitiveAbsence
  };
}

export async function onRequestGet({ request, params }: RequestContext): Promise<Response> {
  const tournamentEncoded = encodeTournament(params?.tournament);
  if (!tournamentEncoded) {
    return jsonError('Tournament parameter is required', 400, { ...JSON_HEADERS });
  }

  const { origin } = new URL(request.url);
  const masterPath = `/reports/${tournamentEncoded}/master.json`;
  const dbPath = `/reports/${tournamentEncoded}/tournament.db`;

  // The probes are independent — run them concurrently; the db result is
  // simply discarded when the master turns out to be missing.
  const [masterProbe, dbProbe] = await Promise.all([
    probeAsset([`https://r2.ciphermaniac.com${masterPath}`, `${origin}${masterPath}`]),
    probeAsset([`https://r2.ciphermaniac.com${dbPath}`, `${origin}${dbPath}`])
  ]);

  if (!masterProbe.ok) {
    // Distinguish "report genuinely absent" (404) from "storage is unreachable"
    // (503). Masking an outage as a 404 makes clients cache/treat a real report
    // as nonexistent.
    if (masterProbe.serverError) {
      return jsonError('Tournament report storage temporarily unavailable', 503, {
        ...JSON_HEADERS,
        'Cache-Control': 'no-store',
        'Retry-After': '30'
      });
    }
    return jsonError('Tournament report not found', 404, { ...JSON_HEADERS });
  }

  // The master exists, but if the DB probe hit a storage error we cannot
  // truthfully report hasTournamentDb — fail loud rather than claim it's absent.
  if (!dbProbe.ok && dbProbe.serverError) {
    return jsonError('Tournament report storage temporarily unavailable', 503, {
      ...JSON_HEADERS,
      'Cache-Control': 'no-store',
      'Retry-After': '30'
    });
  }

  const responseBody = {
    hasTournamentDb: dbProbe.ok,
    assets: {
      masterBytes: masterProbe.bytes,
      updatedAt: masterProbe.updatedAt,
      ...(dbProbe.ok ? { dbBytes: dbProbe.bytes } : {})
    }
  };

  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: JSON_HEADERS
  });
}
