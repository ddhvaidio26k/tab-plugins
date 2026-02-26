import { useState, useCallback, useRef } from "react";
import { vaidioRequest } from "@/lib/vaidio";

export interface VaidioCamera {
  id: number;
  name: string;
  status: string;
  state: string;
  type: string;
}

interface VaidioCountingData {
  time?: string;
  hour?: string;
  count: number;
}

interface VaidioScene {
  id: number;
  datetime: string;
  thumbnailUrl?: string;
  cameraId: number;
}

interface UseVaidioApiReturn {
  isLoading: boolean;
  isSnapshotLoading: boolean;
  isSearchLoading: boolean;
  error: string | null;
  cameras: VaidioCamera[];
  countingData: VaidioCountingData[];
  scenes: VaidioScene[];
  snapshotBase64: string | null;
  activeCameraId: number | null;
  fetchCameras: () => Promise<VaidioCamera[]>;
  fetchSnapshot: (cameraId: number) => Promise<boolean>;
  fetchCounting: (params: Record<string, string>) => Promise<void>;
  searchNLE: (query: string, start: string, end: string) => Promise<void>;
  findWorkingCamera: () => Promise<number | null>;
}

/**
 * Hook for direct Vaidio API interactions (live feeds, counting, NLE search).
 * Uses the currently configured default backend server.
 */
export function useVaidioApi(): UseVaidioApiReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [isSnapshotLoading, setIsSnapshotLoading] = useState(false);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<VaidioCamera[]>([]);
  const [countingData, setCountingData] = useState<VaidioCountingData[]>([]);
  const [scenes, setScenes] = useState<VaidioScene[]>([]);
  const [snapshotBase64, setSnapshotBase64] = useState<string | null>(null);
  const [activeCameraId, setActiveCameraId] = useState<number | null>(null);
  
  const snapshotInProgress = useRef(false);

  const fetchCameras = useCallback(async (): Promise<VaidioCamera[]> => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await vaidioRequest<{
        content: Array<{
          cameraId: number;
          name: string;
          status: string;
          cscState: string;
          cameraType: string;
        }>;
      }>("/api/cameras?statuses=Processing");

      const cameraList: VaidioCamera[] = (data.content || []).map((c) => ({
        id: c.cameraId,
        name: c.name,
        status: c.status,
        state: c.cscState,
        type: c.cameraType,
      }));

      setCameras(cameraList);
      return cameraList;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch cameras");
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchSnapshot = useCallback(async (cameraId: number): Promise<boolean> => {
    if (snapshotInProgress.current) return false;
    snapshotInProgress.current = true;
    setIsSnapshotLoading(true);
    try {
      const data = await vaidioRequest<{ image: string }>(
        `/api/streaming/${cameraId}/live.jpg`,
        "GET",
        undefined,
        true
      );
      setSnapshotBase64(data.image);
      setActiveCameraId(cameraId);
      setError(null);
      return true;
    } catch (err) {
      console.error("Snapshot fetch error:", err);
      return false;
    } finally {
      setIsSnapshotLoading(false);
      snapshotInProgress.current = false;
    }
  }, []);

  const findWorkingCamera = useCallback(async (): Promise<number | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const cameraList = await fetchCameras();

      for (const camera of cameraList.slice(0, 5)) {
        try {
          const snapshotData = await vaidioRequest<{ image: string }>(
            `/api/streaming/${camera.id}/live.jpg`,
            "GET",
            undefined,
            true
          );
          if (snapshotData.image) {
            setSnapshotBase64(snapshotData.image);
            setActiveCameraId(camera.id);
            return camera.id;
          }
        } catch {
          console.log(`Camera ${camera.id} failed, trying next...`);
        }
      }

      setError("No working cameras found");
      return null;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to find working camera");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [fetchCameras]);

  const fetchCounting = useCallback(async (params: Record<string, string>) => {
    setIsLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams(params).toString();
      const data = await vaidioRequest<{ content: Array<{ datetime: string; inCount?: number; count?: number }> }>(
        `/api/counting?${queryParams}`
      );
      const formatted = (data.content || []).map((item) => ({
        hour: new Date(item.datetime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
        count: item.inCount || item.count || 0,
      }));
      setCountingData(formatted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch counting data");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const searchNLE = useCallback(async (query: string, start: string, end: string) => {
    setIsSearchLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams({ query, start, end }).toString();
      const data = await vaidioRequest<{ content: VaidioScene[] }>(
        `/api/scenes?${queryParams}`
      );
      setScenes(data.content || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to search NLE");
    } finally {
      setIsSearchLoading(false);
    }
  }, []);

  return {
    isLoading,
    isSnapshotLoading,
    isSearchLoading,
    error,
    cameras,
    countingData,
    scenes,
    snapshotBase64,
    activeCameraId,
    fetchCameras,
    fetchSnapshot,
    fetchCounting,
    searchNLE,
    findWorkingCamera,
  };
}
