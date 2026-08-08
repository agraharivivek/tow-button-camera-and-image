"use client";

import { useEffect, useId, useState } from "react";
import { Camera24Regular } from "@fluentui/react-icons";
import { capturePhotoAssets, compressImageFile, extractGpsFromFile, isNativeMobile, type CapturedPhotoAsset } from "@/lib/native/camera";
import { useCameraCapture } from "@/components/tasks/hooks/useCameraCapture";
import { useDeviceGallery, type GalleryThumbnail } from "@/components/tasks/hooks/useDeviceGallery";

interface PreviewSelection {
  dataUrl: string;
  file?: File;
  geo?: CapturedPhotoAsset["geo"];
}

interface Props {
  disabled?: boolean;
  onSelect: (assets: CapturedPhotoAsset[]) => void | Promise<void>;
}

function dataUrlToFile(dataUrl: string): File {
  const [meta, data] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(meta)?.[1] ?? "image/jpeg";
  const binary = atob(data ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const ext = mime.includes("png") ? "png" : "jpg";
  return new File([bytes], `camera-${Date.now()}.${ext}`, { type: mime });
}

async function galleryItemToSelection(item: GalleryThumbnail): Promise<PreviewSelection | null> {
  try {
    const response = await fetch(item.webPath);
    const blob = await response.blob();
    const ext = blob.type.includes("png") ? "png" : "jpg";
    const file = new File([blob], `gallery-${Date.now()}.${ext}`, {
      type: blob.type || "image/jpeg",
    });
    const geo = await extractGpsFromFile(file);
    return { dataUrl: item.webPath, file, geo };
  } catch (error) {
    console.warn("[CAMERA_PICKER][gallery:item:error]", error);
    return null;
  }
}

export function CameraGalleryPicker({ disabled, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [previewSelection, setPreviewSelection] = useState<PreviewSelection | null>(null);
  const [saving, setSaving] = useState(false);
  const reactId = useId();
  const previewId = `camera-preview-${reactId.replace(/:/g, "")}`;

  const {
    error: cameraError,
    previewActive,
    flashMode,
    flashSupported,
    startPreview,
    stopPreview,
    capture,
    switchCamera,
    toggleFlash,
  } = useCameraCapture();
  const {
    gallery,
    loading: galleryLoading,
    error: galleryError,
    loadRecent,
    pickFromGallery,
  } = useDeviceGallery();

  useEffect(() => {
    if (!open || !isNativeMobile()) return;
    void loadRecent();
    void startPreview(previewId);
    return () => {
      void stopPreview();
    };
  }, [loadRecent, open, previewId, startPreview, stopPreview]);

  const openPicker = async () => {
    if (!isNativeMobile()) {
      const assets = await capturePhotoAssets({ multiple: false, source: "auto" });
      if (assets.length) await onSelect(assets);
      return;
    }
    setOpen(true);
  };

  const closePicker = async () => {
    await stopPreview();
    setPreviewSelection(null);
    setOpen(false);
  };

  const handleCapture = async () => {
    const shot = await capture();
    if (!shot?.dataUrl) return;
    await stopPreview();
    setPreviewSelection({ dataUrl: shot.dataUrl });
  };

  const handleGalleryThumbClick = async (item: GalleryThumbnail) => {
    const selected = await galleryItemToSelection(item);
    if (!selected) return;
    await stopPreview();
    setPreviewSelection(selected);
  };

  const handleGalleryPicker = async () => {
    const picked = await pickFromGallery();
    if (!picked) return;
    const selected = await galleryItemToSelection(picked);
    if (!selected) return;
    await stopPreview();
    setPreviewSelection(selected);
  };

  const retake = async () => {
    setPreviewSelection(null);
    void startPreview(previewId);
  };

  const confirmSelection = async () => {
    if (!previewSelection || saving) return;
    setSaving(true);
    try {
      const baseFile = previewSelection.file ?? dataUrlToFile(previewSelection.dataUrl);
      const compressed = await compressImageFile(baseFile);
      const geo = previewSelection.geo ?? (await extractGpsFromFile(compressed));
      await onSelect([{ file: compressed, geo }]);
      await closePicker();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="add-photo add-photo--icon"
        onClick={openPicker}
        disabled={disabled}
        aria-label="Open camera"
        title="Open camera"
      >
        <Camera24Regular />
      </button>

      {open && (
        <div className="camera-gallery-picker" role="dialog" aria-modal="true">
          {!previewSelection ? (
            <>
              <div className="camera-gallery-picker__top">
                <button type="button" className="camera-gallery-picker__icon-btn" onClick={closePicker} aria-label="Close camera">
                  ✕
                </button>
                <button
                  type="button"
                  className="camera-gallery-picker__icon-btn"
                  onClick={toggleFlash}
                  disabled={!flashSupported}
                  aria-label="Toggle flash"
                >
                  {flashMode === "on" ? "⚡" : "⚡︎"}
                </button>
              </div>

              <div id={previewId} className="camera-gallery-picker__preview">
                {!previewActive && (
                  <div className="camera-gallery-picker__fallback">
                    <span>Opening camera…</span>
                  </div>
                )}
              </div>

              <div className="camera-gallery-picker__thumbs">
                <button
                  type="button"
                  className="camera-gallery-picker__thumb-action"
                  onClick={handleGalleryPicker}
                  aria-label="Open gallery"
                >
                  🖼
                </button>
                {gallery.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className="camera-gallery-picker__thumb"
                    onClick={() => handleGalleryThumbClick(item)}
                    aria-label="Select from gallery"
                  >
                    <img src={item.webPath} alt="" loading="lazy" />
                  </button>
                ))}
                {galleryLoading && <span className="camera-gallery-picker__status">Loading photos…</span>}
              </div>

              <div className="camera-gallery-picker__bottom">
                <button
                  type="button"
                  className="camera-gallery-picker__switch"
                  onClick={switchCamera}
                  aria-label="Switch camera"
                >
                  ↺
                </button>
                <button type="button" className="camera-gallery-picker__shutter" onClick={handleCapture} aria-label="Capture photo">
                  <span />
                </button>
              </div>
            </>
          ) : (
            <div className="camera-gallery-picker__preview-mode">
              <div className="camera-gallery-picker__top">
                <button type="button" className="camera-gallery-picker__icon-btn" onClick={retake} aria-label="Back to camera">
                  ←
                </button>
              </div>
              <img className="camera-gallery-picker__preview-image" src={previewSelection.dataUrl} alt="Preview" />
              <div className="camera-gallery-picker__preview-actions">
                <button type="button" className="btn-ghost" onClick={retake}>
                  Retake
                </button>
                <button type="button" className="btn-primary" onClick={confirmSelection} disabled={saving}>
                  {saving ? "Saving…" : "Use photo"}
                </button>
              </div>
            </div>
          )}

          {(cameraError || galleryError) && (
            <div className="camera-gallery-picker__error">{cameraError ?? galleryError}</div>
          )}
        </div>
      )}
    </>
  );
}
