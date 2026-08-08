"use client";

import { useCallback, useMemo, useState } from "react";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";

interface CameraPreviewPlugin {
  start: (options: Record<string, unknown>) => Promise<void>;
  stop: () => Promise<void>;
  capture: (options?: Record<string, unknown>) => Promise<{ value?: string }>;
  flip?: () => Promise<void>;
  setFlashMode?: (options: { flashMode: string }) => Promise<void>;
  getSupportedFlashModes?: () => Promise<{ result?: string[]; flashModes?: string[] }>;
}

interface CaptureResult {
  dataUrl: string;
}

type FacingMode = "rear" | "front";
type FlashMode = "off" | "on";
type CameraPermissionState = "prompt" | "prompt-with-rationale" | "granted" | "denied" | "limited";

function isGranted(state?: CameraPermissionState): boolean {
  return state === "granted" || state === "limited";
}

function getCameraPreviewPlugin(): CameraPreviewPlugin | null {
  if (typeof window === "undefined") return null;
  const plugins = (window as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor?.Plugins;
  const plugin = plugins?.CameraPreview as CameraPreviewPlugin | undefined;
  return plugin && typeof plugin.start === "function" ? plugin : null;
}

function ensureDataUrl(value: string | undefined): string {
  if (!value) return "";
  if (value.startsWith("data:")) return value;
  return `data:image/jpeg;base64,${value}`;
}

export function useCameraCapture() {
  const [previewActive, setPreviewActive] = useState(false);
  const [facingMode, setFacingMode] = useState<FacingMode>("rear");
  const [flashMode, setFlashMode] = useState<FlashMode>("off");
  const [flashSupported, setFlashSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewPlugin = useMemo(() => getCameraPreviewPlugin(), []);

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    try {
      const status = await Camera.checkPermissions();
      if (!isGranted(status.camera) || (!isGranted(status.photos) && status.photos !== "prompt")) {
        const requested = await Camera.requestPermissions({ permissions: ["camera", "photos"] });
        if (!isGranted(requested.camera)) {
          setError("Camera permission is required.");
          return false;
        }
      }
      return true;
    } catch (permissionError) {
      console.warn("[CAMERA_PICKER][permissions:error]", permissionError);
      setError("Unable to verify camera permissions.");
      return false;
    }
  }, []);

  const startPreview = useCallback(
    async (previewContainerId: string) => {
      const hasPermission = await requestPermissions();
      if (!hasPermission) return false;

      if (!previewPlugin) {
        setPreviewActive(false);
        return false;
      }

      try {
        await previewPlugin.start({
          parent: previewContainerId,
          className: "camera-gallery-preview",
          toBack: false,
          position: facingMode === "front" ? "front" : "rear",
          storeToFile: false,
          disableExifHeaderStripping: false,
          enableHighResolution: true,
        });
        setPreviewActive(true);
        if (previewPlugin.getSupportedFlashModes) {
          const flash = await previewPlugin.getSupportedFlashModes();
          const modes = flash.result ?? flash.flashModes ?? [];
          setFlashSupported(modes.includes("on") || modes.includes("off") || modes.includes("torch"));
        } else {
          setFlashSupported(false);
        }
        setError(null);
        return true;
      } catch (startError) {
        console.warn("[CAMERA_PICKER][preview:start:error]", startError);
        setPreviewActive(false);
        setError("Unable to start camera preview.");
        return false;
      }
    },
    [facingMode, previewPlugin, requestPermissions]
  );

  const stopPreview = useCallback(async () => {
    if (!previewPlugin || !previewActive) return;
    try {
      await previewPlugin.stop();
    } catch (stopError) {
      console.warn("[CAMERA_PICKER][preview:stop:error]", stopError);
    } finally {
      setPreviewActive(false);
      setFlashMode("off");
    }
  }, [previewActive, previewPlugin]);

  const capture = useCallback(async (): Promise<CaptureResult | null> => {
    try {
      if (previewPlugin && previewActive) {
        const snap = await previewPlugin.capture({ quality: 90 });
        const dataUrl = ensureDataUrl(snap.value);
        if (!dataUrl) return null;
        return { dataUrl };
      }

      const fallback = await Camera.getPhoto({
        source: CameraSource.Camera,
        resultType: CameraResultType.DataUrl,
        quality: 90,
        correctOrientation: true,
        saveToGallery: false,
      });
      if (!fallback.dataUrl) return null;
      return { dataUrl: fallback.dataUrl };
    } catch (captureError) {
      console.warn("[CAMERA_PICKER][capture:error]", captureError);
      setError("Unable to capture image.");
      return null;
    }
  }, [previewActive, previewPlugin]);

  const switchCamera = useCallback(async () => {
    if (!previewPlugin || !previewActive || !previewPlugin.flip) return;
    try {
      await previewPlugin.flip();
      setFacingMode((prev) => (prev === "rear" ? "front" : "rear"));
    } catch (flipError) {
      console.warn("[CAMERA_PICKER][flip:error]", flipError);
      setError("Unable to switch camera.");
    }
  }, [previewActive, previewPlugin]);

  const toggleFlash = useCallback(async () => {
    if (!previewPlugin || !previewActive || !previewPlugin.setFlashMode || !flashSupported) return;
    const next: FlashMode = flashMode === "off" ? "on" : "off";
    try {
      await previewPlugin.setFlashMode({ flashMode: next });
      setFlashMode(next);
    } catch (flashError) {
      console.warn("[CAMERA_PICKER][flash:error]", flashError);
      setError("Unable to toggle flash.");
    }
  }, [flashMode, flashSupported, previewActive, previewPlugin]);

  return {
    error,
    previewActive,
    facingMode,
    flashMode,
    flashSupported,
    startPreview,
    stopPreview,
    capture,
    switchCamera,
    toggleFlash,
    requestPermissions,
  };
}
