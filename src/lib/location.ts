export type LatLng = { lat: number; lng: number };

/**
 * Best-effort ZIP from the user's IP.
 * Uses ipapi.co (no key) and returns null if it fails.
 */
export async function getZipFromIp(): Promise<string | null> {
  try {
    const res = await fetch("https://ipapi.co/json/");
    if (!res.ok) return null;
    const json: any = await res.json();
    const zip = (json?.postal ?? json?.zip ?? "") as string;
    const trimmed = zip.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a US ZIP to lat/lng using Zippopotam.us (no key).
 */
export async function geocodeZip(zip: string): Promise<LatLng | null> {
  const clean = zip.trim();
  if (!clean) return null;
  try {
    const res = await fetch(
      `https://api.zippopotam.us/us/${encodeURIComponent(clean)}`,
    );
    if (!res.ok) return null;
    const json: any = await res.json();
    const place = json?.places?.[0];
    const lat = Number(place?.latitude);
    const lng = Number(place?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}
