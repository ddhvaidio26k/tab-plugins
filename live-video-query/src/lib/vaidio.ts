import { supabase } from "@/integrations/supabase/client";

export interface VaidioCamera {
  cameraId: number;
  name: string;
  status: string | null;
  cscState: string | null;
  cameraType: string;
  resolution?: { width: number; height: number } | null;
  snapshot: string | null;
  thumbnail: string | null;
}

export interface VaidioAlert {
  id: string;
  type: string;
  state: string;
  cameraId: number;
  datetime: string;
  message?: string;
}

export async function vaidioRequest<T>(
  endpoint: string,
  method: string = 'GET',
  body?: unknown,
  returnImage: boolean = false,
  serverId?: string
): Promise<T> {
  const payload: Record<string, unknown> = { endpoint, method, body, returnImage };
  if (serverId) payload.serverId = serverId;

  const { data, error } = await supabase.functions.invoke('vaidio-proxy', {
    body: payload,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as T;
}

export async function getCameras(): Promise<VaidioCamera[]> {
  const response = await vaidioRequest<{ content: VaidioCamera[] }>('/api/cameras');
  return response.content || [];
}

export async function getCameraSnapshot(snapshotPath: string): Promise<string> {
  if (!snapshotPath) {
    throw new Error('No snapshot path available');
  }
  const response = await vaidioRequest<{ image: string }>(
    `/${snapshotPath}`,
    'GET',
    undefined,
    true
  );
  return response.image;
}

/**
 * Fetch snapshots for multiple cameras in a single request.
 * NOTE: Uses a special batch payload shape handled by the vaidio-proxy edge function.
 * When exporting as a plugin, replace with direct Vaidio API calls
 * to GET /api/streaming/{cameraId}/live.jpg for each camera.
 */
export async function getCameraSnapshotsBatch(
  items: Array<{ cameraId: number; snapshot: string | null }>
): Promise<Record<number, string>> {
  const batchSnapshots: Record<string, string | null> = {};
  for (const item of items) {
    batchSnapshots[String(item.cameraId)] = item.snapshot;
  }

  const { data, error } = await supabase.functions.invoke('vaidio-proxy', {
    body: { batchSnapshots },
  });

  if (error) {
    throw new Error(error.message);
  }

  const images = (data as { images?: Record<string, string | null> } | null)?.images || {};
  const result: Record<number, string> = {};
  for (const [key, value] of Object.entries(images)) {
    const id = Number(key);
    if (!Number.isFinite(id) || !value) continue;
    result[id] = value;
  }
  return result;
}

export async function getAlerts(params: {
  start: string;
  end: string;
  cameraIds?: number[];
}): Promise<VaidioAlert[]> {
  const queryParams = new URLSearchParams({
    start: params.start,
    end: params.end,
  });
  if (params.cameraIds?.length) {
    queryParams.set('cameraIds', params.cameraIds.join(','));
  }
  const response = await vaidioRequest<{ content: VaidioAlert[] }>(
    `/api/alerts?${queryParams.toString()}`
  );
  return response.content || [];
}

export async function getSystemInfo(): Promise<{ servers: unknown[]; modules: unknown[] }> {
  const [servers, modules] = await Promise.all([
    vaidioRequest<{ content: unknown[] }>('/api/ainvrs'),
    vaidioRequest<{ content: unknown[] }>('/api/modules'),
  ]);
  return {
    servers: servers.content || [],
    modules: modules.content || [],
  };
}
