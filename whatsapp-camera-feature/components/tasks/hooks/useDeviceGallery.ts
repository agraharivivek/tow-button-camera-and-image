"use client";

import { useCallback, useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Camera } from "@capacitor/camera";

export interface GalleryThumbnail {
  id: string;
  webPath: string;
}

interface MediaPlugin {
  getMedias: (options?: Record<string, unknown>) => Promise<unknown>;
}

function getMediaPlugin(): MediaPlugin | null {
  if (typeof window === "undefined") return null;
  const plugins = (window as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor?.Plugins;
  const plugin = plugins?.Media as MediaPlugin | undefined;
  return plugin && typeof plugin.getMedias === "function" ? plugin : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function mediaArray(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [];
  const bag = payload as Record<string, unknown>;
  const list = bag.medias ?? bag.media ?? bag.photos ?? bag.items ?? bag.data;
  return Array.isArray(list) ? list : [];
}

function normalizeMediaItem(item: unknown, idx: number): GalleryThumbnail | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Record<string, unknown>;
  const webPath = asString(row.webPath) ?? asString(row.thumbnailPath) ?? asString(row.path) ?? asString(row.localPath);
  if (!webPath) return null;
  const converted = webPath.startsWith("http") || webPath.startsWith("data:")
    ? webPath
    : Capacitor.convertFileSrc(webPath);
  return {
    id: asString(row.identifier) ?? asString(row.id) ?? `${idx}-${converted}`,
    webPath: converted,
  };
}

export function useDeviceGallery() {
  const [gallery, setGallery] = useState<GalleryThumbnail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaPlugin = useMemo(() => getMediaPlugin(), []);

  const loadRecent = useCallback(
    async (limit = 24) => {
      if (!mediaPlugin) {
        setGallery([]);
        return;
      }

      setLoading(true);
      try {
        const status = await Camera.checkPermissions();
        if (status.photos !== "granted" && status.photos !== "limited") {
          await Camera.requestPermissions({ permissions: ["photos"] });
        }

        const attempts: Record<string, unknown>[] = [
          { quantity: limit },
          { quantity: limit, types: "photos" },
          { limit },
        ];

        let items: GalleryThumbnail[] = [];
        for (const options of attempts) {
          try {
            const response = await mediaPlugin.getMedias(options);
            items = mediaArray(response)
              .map((entry, idx) => normalizeMediaItem(entry, idx))
              .filter((entry): entry is GalleryThumbnail => !!entry);
            if (items.length) break;
          } catch {
            // try next supported option shape
          }
        }

        setGallery(items.slice(0, limit));
        setError(null);
      } catch (loadError) {
        console.warn("[CAMERA_PICKER][gallery:load:error]", loadError);
        setGallery([]);
        setError("Unable to load device gallery.");
      } finally {
        setLoading(false);
      }
    },
    [mediaPlugin]
  );

  const pickFromGallery = useCallback(async (): Promise<GalleryThumbnail | null> => {
    try {
      const picked = await Camera.pickImages({ limit: 1, quality: 90 });
      const photo = picked.photos[0];
      if (!photo?.webPath) return null;
      return {
        id: `picked-${Date.now()}`,
        webPath: photo.webPath,
      };
    } catch (errorPick) {
      console.warn("[CAMERA_PICKER][gallery:pick:error]", errorPick);
      setError("Unable to pick image from gallery.");
      return null;
    }
  }, []);

  return {
    gallery,
    loading,
    error,
    loadRecent,
    pickFromGallery,
  };
}
