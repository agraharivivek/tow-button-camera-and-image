import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";

export type PhotoSource = "auto" | "gallery" | "camera";

export interface PhotoGeolocation {
  latitude: number;
  longitude: number;
  source: "exif";
}

export interface CapturedPhotoAsset {
  file: File;
  geo?: PhotoGeolocation;
}

interface CaptureOptions {
  multiple?: boolean;
  source?: PhotoSource;
}

interface CompressOptions {
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
}

function isMobileUserAgent(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  return /android|iphone|ipad|ipod|mobile|capacitor/i.test(ua);
}

export function isNativeMobile(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (cap && typeof cap.isNativePlatform === "function") {
    return cap.isNativePlatform();
  }
  return isMobileUserAgent();
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (
    value &&
    typeof value === "object" &&
    "numerator" in value &&
    "denominator" in value
  ) {
    const num = normalizeNumber((value as { numerator?: unknown }).numerator);
    const den = normalizeNumber((value as { denominator?: unknown }).denominator);
    if (num === null || den === null || den === 0) return null;
    return num / den;
  }
  return null;
}

function dmsToDecimal(value: unknown, ref?: unknown): number | null {
  if (Array.isArray(value) && value.length >= 3) {
    const d = normalizeNumber(value[0]);
    const m = normalizeNumber(value[1]);
    const s = normalizeNumber(value[2]);
    if (d === null || m === null || s === null) return null;
    let decimal = Math.abs(d) + m / 60 + s / 3600;
    const direction = String(ref ?? "").toUpperCase();
    if (direction === "S" || direction === "W") decimal *= -1;
    return decimal;
  }

  const direct = normalizeNumber(value);
  if (direct === null) return null;
  let decimal = direct;
  const direction = String(ref ?? "").toUpperCase();
  if ((direction === "S" || direction === "W") && decimal > 0) decimal *= -1;
  return decimal;
}

function extractGpsFromExif(exif: unknown): PhotoGeolocation | undefined {
  console.log("[GEO-DEBUG][extractGpsFromExif:input]", exif);
  if (!exif || typeof exif !== "object") return undefined;
  const x = exif as Record<string, unknown>;

  const lat =
    dmsToDecimal(x.GPSLatitude, x.GPSLatitudeRef) ??
    normalizeNumber(x.latitude) ??
    normalizeNumber(x.lat);
  const lng =
    dmsToDecimal(x.GPSLongitude, x.GPSLongitudeRef) ??
    normalizeNumber(x.longitude) ??
    normalizeNumber(x.lng) ??
    normalizeNumber(x.lon);

  console.log("[GEO-DEBUG][extractGpsFromExif:parsed]", { lat, lng });

  if (lat === null || lng === null) return undefined;
  return { latitude: lat, longitude: lng, source: "exif" };
}

export async function extractGpsFromFile(file: File): Promise<PhotoGeolocation | undefined> {
  try {
    const exifr = await import("exifr");
    const gps = await exifr.gps(file);
    console.log("[GEO-DEBUG][extractGpsFromFile:raw]", {
      file: file.name,
      gps,
    });
    if (!gps) return undefined;
    const lat = normalizeNumber((gps as { latitude?: unknown }).latitude);
    const lng = normalizeNumber((gps as { longitude?: unknown }).longitude);
    console.log("[GEO-DEBUG][extractGpsFromFile:parsed]", {
      file: file.name,
      lat,
      lng,
    });
    if (lat === null || lng === null) return undefined;
    return { latitude: lat, longitude: lng, source: "exif" };
  } catch (error) {
    console.warn("[GEO-DEBUG][extractGpsFromFile:error]", {
      file: file.name,
      error,
    });
    return undefined;
  }
}

export async function compressImageFile(file: File, options?: CompressOptions): Promise<File> {
  if (typeof document === "undefined" || !file.type.startsWith("image/")) return file;

  const quality = options?.quality ?? 0.82;
  const maxWidth = options?.maxWidth ?? 1920;
  const maxHeight = options?.maxHeight ?? 1920;

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Unable to load image for compression."));
      img.src = objectUrl;
    });

    let width = image.naturalWidth || image.width;
    let height = image.naturalHeight || image.height;
    if (!width || !height) return file;

    const ratio = Math.min(1, maxWidth / width, maxHeight / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(image, 0, 0, width, height);

    const targetType = file.type === "image/png" ? "image/png" : "image/jpeg";
    const compressedBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, targetType, quality)
    );
    if (!compressedBlob) return file;

    if (compressedBlob.size >= file.size) return file;
    return new File([compressedBlob], file.name, { type: compressedBlob.type || targetType });
  } catch (error) {
    console.warn("[GEO-DEBUG][compressImageFile:error]", error);
    return file;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function chooseFromWeb(options?: CaptureOptions): Promise<CapturedPhotoAsset[]> {
  if (typeof document === "undefined") return [];

  const source = options?.source ?? "auto";
  const files = await new Promise<File[]>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    if (source === "camera") input.setAttribute("capture", "environment");
    if (options?.multiple) input.multiple = true;
    input.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none";
    document.body.appendChild(input);
    input.onchange = () => {
      document.body.removeChild(input);
      resolve(input.files ? Array.from(input.files) : []);
    };
    input.click();
  });

  console.log("[GEO-DEBUG][chooseFromWeb:selected-files]", {
    source,
    count: files.length,
    names: files.map((f) => f.name),
  });

  const assets = await Promise.all(
    files.map(async (file) => {
      const compressed = await compressImageFile(file);
      return {
        file: compressed,
        geo: await extractGpsFromFile(compressed),
      };
    })
  );
  return assets;
}

async function photoToFile(photo: {
  webPath?: string;
  format?: string;
  exif?: unknown;
}, idx: number): Promise<CapturedPhotoAsset | null> {
  const webPath = photo.webPath;
  if (!webPath) return null;

  const blob = await fetch(webPath).then((r) => r.blob());
  const ext = (photo.format || "jpeg").replace(/^\./, "");
  const name = `photo-${Date.now()}-${idx}.${ext}`;
  const file = new File([blob], name, { type: blob.type || `image/${ext}` });
  const compressed = await compressImageFile(file);
  const geo = extractGpsFromExif(photo.exif) ?? (await extractGpsFromFile(compressed));
  console.log("[GEO-DEBUG][photoToFile]", {
    idx,
    name,
    hasExif: !!photo.exif,
    geo,
  });
  return {
    file: compressed,
    geo,
  };
}

async function chooseFromNative(options?: CaptureOptions): Promise<CapturedPhotoAsset[]> {
  const source = options?.source ?? "auto";
  console.log("[GEO-DEBUG][chooseFromNative:start]", {
    source,
    multiple: options?.multiple ?? false,
  });
  const requestedSource =
    source === "camera"
      ? CameraSource.Camera
      : source === "gallery"
      ? CameraSource.Photos
      : CameraSource.Prompt;

  if ((options?.multiple ?? false) && source !== "camera") {
    const picked = await Camera.pickImages({
      quality: 90,
      limit: 12,
    });
    console.log("[GEO-DEBUG][chooseFromNative:pickImages]", {
      count: picked.photos.length,
      hasExif: picked.photos.map((p) => !!p.exif),
    });
    const rows = await Promise.all(picked.photos.map((p, i) => photoToFile(p, i)));
    return rows.filter((r): r is CapturedPhotoAsset => !!r);
  }

  const photo = await Camera.getPhoto({
    source: requestedSource,
    resultType: CameraResultType.Uri,
    quality: 90,
    correctOrientation: true,
    saveToGallery: false,
  });
  console.log("[GEO-DEBUG][chooseFromNative:getPhoto]", {
    hasWebPath: !!photo.webPath,
    format: photo.format,
    hasExif: !!photo.exif,
    exifKeys: photo.exif ? Object.keys(photo.exif as Record<string, unknown>).slice(0, 20) : [],
  });
  const row = await photoToFile(photo, 0);
  return row ? [row] : [];
}

/**
 * Returns selected/captured photos and EXIF GPS metadata when available.
 */
export async function capturePhotoAssets(options?: CaptureOptions): Promise<CapturedPhotoAsset[]> {
  console.log("[GEO-DEBUG][capturePhotoAssets:start]", {
    options,
    native: isNativeMobile(),
  });
  if (isNativeMobile()) {
    try {
      return await chooseFromNative(options);
    } catch (err) {
      console.warn("[GEO-DEBUG][capturePhotoAssets:fallback-to-web]", err);
      // Graceful fallback to browser picker in environments where Camera plugin is unavailable.
      return chooseFromWeb(options);
    }
  }
  return chooseFromWeb(options);
}

/** Backward-compatible helper used by existing callers that only need File[]. */
export async function capturePhotos(options?: CaptureOptions): Promise<File[]> {
  const assets = await capturePhotoAssets(options);
  return assets.map((a) => a.file);
}
