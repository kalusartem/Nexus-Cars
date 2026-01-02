import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";

type ExistingImage = {
  id: string;
  bucket: string;
  path: string;
  position: number;
};

type Props = {
  listingId: string; // must exist already
  onUploaded?: () => void;
};

const BUCKET = "car-images";

function getFileExt(filename: string) {
  const parts = filename.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "jpg";
}

function safeImageExt(ext: string) {
  const allowed = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
  return allowed.has(ext) ? ext : "jpg";
}

function buildObjectPath(listingId: string, ext: string) {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `listings/${listingId}/${id}.${ext}`;
}

function publicUrl(bucket: string, path: string) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

function sortByPosition(images: ExistingImage[]) {
  return [...images].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

function normalizePositions(images: ExistingImage[]) {
  // normalize to 0..n-1 based on current sorted order
  const sorted = sortByPosition(images);
  return sorted.map((img, idx) => ({ ...img, position: idx }));
}

export function ListingImageUploader({ listingId, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const qc = useQueryClient();

  const [selected, setSelected] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const queryKey = ["listing-images", listingId] as const;

  // Self-fetch existing images (Option A)
  const {
    data: existingImages = [],
    isLoading: imagesLoading,
    isError: imagesIsError,
    error: imagesError,
  } = useQuery({
    queryKey,
    enabled: !!listingId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("listing_images")
        .select("id, bucket, path, position")
        .eq("listing_id", listingId)
        .order("position", { ascending: true });

      if (error) throw error;
      return (data ?? []) as ExistingImage[];
    },
    staleTime: 1000 * 10,
  });

  const existingSorted = useMemo(() => {
    return sortByPosition(existingImages);
  }, [existingImages]);

  const previews = useMemo(() => {
    return selected.map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
  }, [selected]);

  // Cleanup object URLs when selection changes/unmounts
  const prevUrlsRef = useRef<string[]>([]);
  if (prevUrlsRef.current.length) {
    for (const u of prevUrlsRef.current) URL.revokeObjectURL(u);
  }
  prevUrlsRef.current = previews.map((p) => p.url);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!listingId) throw new Error("listingId is required");
      if (selected.length === 0) return;

      setErrorMsg(null);
      setBusy(true);

      const startPos =
        existingSorted.length > 0
          ? Math.max(...existingSorted.map((img) => img.position)) + 1
          : 0;

      const uploadedRows: Array<{
        bucket: string;
        path: string;
        position: number;
      }> = [];

      for (let i = 0; i < selected.length; i++) {
        const file = selected[i];
        const ext = safeImageExt(getFileExt(file.name));
        const path = buildObjectPath(listingId, ext);

        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, {
            cacheControl: "3600",
            upsert: false,
            contentType: file.type || undefined,
          });

        if (uploadError) throw uploadError;

        uploadedRows.push({
          bucket: BUCKET,
          path,
          position: startPos + i,
        });
      }

      const payload = uploadedRows.map((r) => ({
        listing_id: listingId,
        bucket: r.bucket,
        path: r.path,
        position: r.position,
      }));

      const { error: insertError } = await supabase
        .from("listing_images")
        .insert(payload);

      if (insertError) {
        // best-effort rollback storage
        try {
          await supabase.storage
            .from(BUCKET)
            .remove(uploadedRows.map((r) => r.path));
        } catch {
          // ignore rollback errors
        }
        throw insertError;
      }

      setSelected([]);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey });
      await qc.invalidateQueries({ queryKey: ["listing", listingId] });
      onUploaded?.();
    },
    onError: (err: any) => {
      setErrorMsg(err?.message ?? "Upload failed");
    },
    onSettled: () => {
      setBusy(false);
    },
  });

  /**
   * DELETE (optimistic)
   * - remove immediately from cache
   * - rollback on error
   * - after delete, normalize DB positions so there are no gaps
   */
  const deleteMutation = useMutation({
    mutationFn: async (img: ExistingImage) => {
      const { error: dbErr } = await supabase
        .from("listing_images")
        .delete()
        .eq("id", img.id);
      if (dbErr) throw dbErr;

      // best-effort storage removal
      const { error: stErr } = await supabase.storage
        .from(img.bucket)
        .remove([img.path]);
      if (stErr) console.warn("Storage delete failed:", stErr.message);

      // Normalize positions in DB (keeps cover at 0, prevents gaps)
      const { data, error } = await supabase
        .from("listing_images")
        .select("id, position")
        .eq("listing_id", listingId)
        .order("position", { ascending: true });

      if (error) throw error;
      const rows = (data ?? []) as Array<{ id: string; position: number }>;

      // two-phase update to avoid unique collisions
      for (let i = 0; i < rows.length; i++) {
        const { error: e } = await supabase
          .from("listing_images")
          .update({ position: 1000 + i })
          .eq("id", rows[i].id);
        if (e) throw e;
      }
      for (let i = 0; i < rows.length; i++) {
        const { error: e } = await supabase
          .from("listing_images")
          .update({ position: i })
          .eq("id", rows[i].id);
        if (e) throw e;
      }
    },
    onMutate: async (img) => {
      setErrorMsg(null);
      await qc.cancelQueries({ queryKey });

      const prev = qc.getQueryData<ExistingImage[]>(queryKey) ?? [];

      // Optimistically remove + normalize positions
      const next = normalizePositions(prev.filter((x) => x.id !== img.id));
      qc.setQueryData(queryKey, next);

      return { prev };
    },
    onError: (err: any, _img, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
      setErrorMsg(err?.message ?? "Delete failed");
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey });
      await qc.invalidateQueries({ queryKey: ["listing", listingId] });
      onUploaded?.();
    },
  });

  /**
   * REORDER swap (optimistic)
   */
  const reorderMutation = useMutation({
    mutationFn: async (args: { a: ExistingImage; b: ExistingImage }) => {
      const { a, b } = args;
      const temp = -999999;

      const { error: e1 } = await supabase
        .from("listing_images")
        .update({ position: temp })
        .eq("id", a.id);
      if (e1) throw e1;

      const { error: e2 } = await supabase
        .from("listing_images")
        .update({ position: a.position })
        .eq("id", b.id);
      if (e2) throw e2;

      const { error: e3 } = await supabase
        .from("listing_images")
        .update({ position: b.position })
        .eq("id", a.id);
      if (e3) throw e3;
    },
    onMutate: async ({ a, b }) => {
      setErrorMsg(null);
      await qc.cancelQueries({ queryKey });

      const prev = qc.getQueryData<ExistingImage[]>(queryKey) ?? [];

      const next = prev.map((img) => {
        if (img.id === a.id) return { ...img, position: b.position };
        if (img.id === b.id) return { ...img, position: a.position };
        return img;
      });

      qc.setQueryData(queryKey, sortByPosition(next));
      return { prev };
    },
    onError: (err: any, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
      setErrorMsg(err?.message ?? "Reorder failed");
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey });
      await qc.invalidateQueries({ queryKey: ["listing", listingId] });
      onUploaded?.();
    },
  });

  /**
   * SET COVER (optimistic + safe DB update)
   * - optimistic: move chosen image to front, normalize positions
   * - server: two-phase update to avoid unique collisions
   */
  const setCoverMutation = useMutation({
    mutationFn: async (img: ExistingImage) => {
      const { data, error } = await supabase
        .from("listing_images")
        .select("id, position")
        .eq("listing_id", listingId)
        .order("position", { ascending: true });

      if (error) throw error;

      const rows = (data ?? []) as Array<{ id: string; position: number }>;
      const idx = rows.findIndex((r) => r.id === img.id);
      if (idx <= 0) return;

      const reordered = [rows[idx], ...rows.filter((_, i) => i !== idx)];

      // Phase 1: move out of the way
      for (let i = 0; i < reordered.length; i++) {
        const { error: e } = await supabase
          .from("listing_images")
          .update({ position: 1000 + i })
          .eq("id", reordered[i].id);
        if (e) throw e;
      }

      // Phase 2: normalize
      for (let i = 0; i < reordered.length; i++) {
        const { error: e } = await supabase
          .from("listing_images")
          .update({ position: i })
          .eq("id", reordered[i].id);
        if (e) throw e;
      }
    },
    onMutate: async (img) => {
      setErrorMsg(null);
      await qc.cancelQueries({ queryKey });

      const prev = qc.getQueryData<ExistingImage[]>(queryKey) ?? [];
      const sorted = sortByPosition(prev);

      const idx = sorted.findIndex((x) => x.id === img.id);
      if (idx <= 0) return { prev }; // already cover or not found

      const reordered = [sorted[idx], ...sorted.filter((_, i) => i !== idx)];
      const next = normalizePositions(reordered);

      qc.setQueryData(queryKey, next);
      return { prev };
    },
    onError: (err: any, _img, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
      setErrorMsg(err?.message ?? "Set cover failed");
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey });
      await qc.invalidateQueries({ queryKey: ["listing", listingId] });
      onUploaded?.();
    },
  });

  const onPick = (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files);
    const filtered = arr.filter((f) => f.type.startsWith("image/"));
    setSelected((prev) => [...prev, ...filtered]);
  };

  const removeSelected = (index: number) => {
    setSelected((prev) => prev.filter((_, i) => i !== index));
  };

  const anyReorderBusy =
    reorderMutation.isPending || setCoverMutation.isPending;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-semibold">Images</h3>
          <p className="text-sm text-slate-400 mt-1">
            Upload multiple images (JPG/PNG/WebP). Stored in Supabase Storage.
          </p>
        </div>

        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => onPick(e.target.files)}
          />

          <button
            type="button"
            className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            Add images
          </button>

          <button
            type="button"
            className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
            disabled={busy || selected.length === 0}
            onClick={() => uploadMutation.mutate()}
          >
            Upload {selected.length ? `(${selected.length})` : ""}
          </button>
        </div>
      </div>

      {errorMsg ? (
        <div className="mt-3 text-sm text-red-300">{errorMsg}</div>
      ) : null}

      {/* Existing images */}
      {imagesLoading ? (
        <div className="mt-4 text-sm text-slate-400">Loading images…</div>
      ) : imagesIsError ? (
        <div className="mt-4 text-sm text-red-300">
          Failed to load images:{" "}
          {(imagesError as any)?.message ?? "Unknown error"}
        </div>
      ) : existingSorted.length > 0 ? (
        <div className="mt-4">
          <div className="text-sm text-slate-300 mb-2">Current images</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {existingSorted.map((img, index) => {
              const url = publicUrl(img.bucket, img.path);
              const isCover = index === 0;

              const moveUp = () => {
                if (index === 0) return;
                reorderMutation.mutate({
                  a: existingSorted[index - 1],
                  b: img,
                });
              };

              const moveDown = () => {
                if (index === existingSorted.length - 1) return;
                reorderMutation.mutate({
                  a: img,
                  b: existingSorted[index + 1],
                });
              };

              return (
                <div
                  key={img.id}
                  className="relative rounded-xl border border-slate-800 overflow-hidden"
                >
                  <img
                    src={url}
                    alt="Listing"
                    className="w-full h-32 object-cover"
                  />

                  {isCover ? (
                    <div className="absolute top-2 left-2 text-xs px-2 py-1 rounded bg-black/70">
                      Cover
                    </div>
                  ) : null}

                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 p-2 flex items-center justify-between gap-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/20 disabled:opacity-50"
                        onClick={moveUp}
                        disabled={index === 0 || anyReorderBusy}
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/20 disabled:opacity-50"
                        onClick={moveDown}
                        disabled={
                          index === existingSorted.length - 1 || anyReorderBusy
                        }
                        title="Move down"
                      >
                        ↓
                      </button>
                    </div>

                    <div className="flex gap-2">
                      {!isCover ? (
                        <button
                          type="button"
                          className="px-2 py-1 text-xs rounded bg-blue-600/80 hover:bg-blue-600 disabled:opacity-50"
                          onClick={() => setCoverMutation.mutate(img)}
                          disabled={setCoverMutation.isPending}
                          title="Set as cover"
                        >
                          Set cover
                        </button>
                      ) : null}

                      <button
                        type="button"
                        className="px-2 py-1 text-xs rounded bg-red-600/70 hover:bg-red-600 disabled:opacity-50"
                        onClick={() => deleteMutation.mutate(img)}
                        disabled={deleteMutation.isPending}
                        title="Remove"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-4 text-sm text-slate-400">No images yet.</div>
      )}

      {/* Selected images to upload */}
      {selected.length > 0 ? (
        <div className="mt-5">
          <div className="text-sm text-slate-300 mb-2">
            Ready to upload
            {busy ? (
              <span className="text-slate-400"> • Uploading…</span>
            ) : null}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {previews.map((p, idx) => (
              <div key={p.url} className="relative group">
                <img
                  src={p.url}
                  alt={p.file.name}
                  className="w-full h-32 object-cover rounded-xl border border-slate-800"
                />
                <button
                  type="button"
                  className="absolute top-2 right-2 px-2 py-1 text-xs rounded bg-black/60 hover:bg-black/80 opacity-0 group-hover:opacity-100 transition"
                  onClick={() => removeSelected(idx)}
                  disabled={busy}
                  title="Remove from upload"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
