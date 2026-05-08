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
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=300, s-maxage=300'
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
  for (const url of urls) {
    const response = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (!response || !response.ok) {
      continue;
    }
    return {
      ok: true,
      bytes: parseBytes(response.headers),
      updatedAt: parseUpdatedAt(response.headers)
    };
  }

  return {
    ok: false,
    bytes: 0,
    updatedAt: ''
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

  const masterProbe = await probeAsset([`https://r2.ciphermaniac.com${masterPath}`, `${origin}${masterPath}`]);

  if (!masterProbe.ok) {
    return jsonError('Tournament report not found', 404, { ...JSON_HEADERS });
  }

  const dbProbe = await probeAsset([`https://r2.ciphermaniac.com${dbPath}`, `${origin}${dbPath}`]);

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
