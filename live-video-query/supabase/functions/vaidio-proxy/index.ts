import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Per-server token cache
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function getCandidateBaseUrls(baseUrl: string): string[] {
  const normalized = normalizeBaseUrl(baseUrl);
  const candidates = [normalized];

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol === 'https:') {
      candidates.push(`http://${parsed.hostname}:8380`);
    } else if (parsed.protocol === 'http:' && !parsed.port) {
      candidates.push(`http://${parsed.hostname}:8380`);
    }
  } catch {
    // keep original URL only
  }

  return [...new Set(candidates)];
}

function buildVaidioUrl(baseUrl: string, endpoint: string): string {
  const root = normalizeBaseUrl(baseUrl);
  const normalized = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  if (normalized.startsWith('/ainvr')) {
    return `${root}${normalized}`;
  }
  return `${root}/ainvr${normalized}`;
}

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function requestToken(baseUrl: string, username: string, password: string): Promise<{ token: string; expiresIn: number }> {
  const tokenUrl = `${normalizeBaseUrl(baseUrl)}/ainvr/api/oauth2/token`;
  console.log(`[vaidio-proxy] Requesting token from: ${tokenUrl}`);
  const tokenResponse = await fetchWithTimeout(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
  });

  if (!tokenResponse.ok) {
    throw new Error(`Auth failed: ${tokenResponse.status}`);
  }

  const data = await tokenResponse.json();
  console.log(`[vaidio-proxy] Token acquired successfully`);
  return {
    token: data.access_token,
    expiresIn: data.expires_in || 3600,
  };
}

async function getAccessToken(vaidioUrl: string, username: string, password: string): Promise<{ token: string; baseUrl: string }> {
  const candidates = getCandidateBaseUrls(vaidioUrl);
  let lastError: unknown = null;

  for (const candidateUrl of candidates) {
    const cacheKey = `${candidateUrl}|${username}`;
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60000) {
      return { token: cached.token, baseUrl: candidateUrl };
    }

    try {
      const { token, expiresIn } = await requestToken(candidateUrl, username, password);
      tokenCache.set(cacheKey, { token, expiresAt: Date.now() + (expiresIn * 1000) });
      return { token, baseUrl: candidateUrl };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : '';
      const isConnectivityIssue =
        message.includes('UnknownIssuer') ||
        message.includes('timed out') ||
        message.includes('Connect');

      if (!isConnectivityIssue) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Auth failed');
}

interface ServerCreds {
  url: string;
  username: string;
  password: string;
}

async function resolveServer(serverId?: string): Promise<ServerCreds> {
  // If serverId provided, look up from DB
  if (serverId) {
    const sbUrl = Deno.env.get('SUPABASE_URL')!;
    const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb = createClient(sbUrl, sbKey);
    const { data, error } = await sb
      .from('vaidio_servers')
      .select('url, username, password')
      .eq('id', serverId)
      .single();
    if (error || !data) throw new Error('Server not found');
    return data as ServerCreds;
  }

  // Try default server from DB
  try {
    const sbUrl = Deno.env.get('SUPABASE_URL')!;
    const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb = createClient(sbUrl, sbKey);
    const { data } = await sb
      .from('vaidio_servers')
      .select('url, username, password')
      .eq('is_default', true)
      .eq('is_active', true)
      .single();
    if (data) return data as ServerCreds;
  } catch { /* fall through to env vars */ }

  // Fallback to env vars
  const url = Deno.env.get('VAIDIO_URL');
  const username = Deno.env.get('VAIDIO_USERNAME');
  const password = Deno.env.get('VAIDIO_PASSWORD');
  if (!url || !username || !password) {
    throw new Error('No Vaidio server configured');
  }
  return { url, username, password };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { endpoint, method = 'GET', body, returnImage = false, batchSnapshots, serverId } = await req.json();

    const server = await resolveServer(serverId);
    console.log(`[vaidio-proxy] Connecting to server: ${normalizeBaseUrl(server.url)} (user: ${server.username})`);
    const access_token = await getAccessToken(server.url, server.username, server.password);

    // Batch snapshot mode
    if (batchSnapshots && typeof batchSnapshots === 'object') {
      const entries = Object.entries(batchSnapshots as Record<string, string | null | undefined>);
      const images: Record<string, string | null> = {};

      for (const [key, snapshotPath] of entries) {
        if (!snapshotPath) { images[key] = null; continue; }
        const url = buildVaidioUrl(access_token.baseUrl, snapshotPath);
        const res = await fetchWithTimeout(url, { method: 'GET', headers: { 'Authorization': `Bearer ${access_token.token}` } });
        if (!res.ok) { images[key] = null; continue; }
        const buf = await res.arrayBuffer();
        const contentType = res.headers.get('content-type') || 'image/jpeg';
        images[key] = `data:${contentType};base64,${uint8ArrayToBase64(new Uint8Array(buf))}`;
      }

      return new Response(JSON.stringify({ images }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Single API request
    const apiUrl = buildVaidioUrl(access_token.baseUrl, endpoint);
    console.log(`[vaidio-proxy] ${method} ${apiUrl}`);
    const apiResponse = await fetchWithTimeout(apiUrl, {
      method,
      headers: { 'Authorization': `Bearer ${access_token.token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (returnImage) {
      if (!apiResponse.ok) {
        return new Response(
          JSON.stringify({ error: `Failed to fetch image: ${apiResponse.status}` }),
          { status: apiResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const imageBuffer = await apiResponse.arrayBuffer();
      const contentType = apiResponse.headers.get('content-type') || 'image/jpeg';
      return new Response(
        JSON.stringify({ image: `data:${contentType};base64,${uint8ArrayToBase64(new Uint8Array(imageBuffer))}` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await apiResponse.json();
    return new Response(JSON.stringify(data), {
      status: apiResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('Vaidio proxy error:', error);
    const isAbort = error instanceof DOMException && error.name === 'AbortError';
    const errorMessage = isAbort
      ? 'Connection timed out — Vaidio server is unreachable from the cloud backend'
      : (error instanceof Error ? error.message : 'Unknown error');
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: isAbort ? 504 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
