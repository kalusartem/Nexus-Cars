// src/features/listings/components/ListingForm.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import { geocodeZip } from "../../../lib/location";

type Mode = "create" | "edit";

export type ListingRow = {
  id: string;
  seller_id: string;

  make: string;
  model: string;
  year: number;
  price: number;
  mileage: number;

  fuel_type: string;
  transmission: string;

  description: string | null;
  is_active: boolean | null;

  zip_code?: string | null;
  lat?: number | null;
  lng?: number | null;

  created_at?: string;
};

type ListingImageRow = {
  id: string;
  listing_id: string;
  bucket: string;
  path: string;
  position: number;
};

type Props = {
  mode: Mode;
  listingId?: string; // required for edit
  initial?: Partial<ListingRow>; // initial listing fields (edit)
  onCreated?: (listingId: string) => void;
  onSaved?: () => void;
};

type FormState = {
  make: string;
  model: string;
  zip_code: string;
  year: string;
  price: string;
  mileage: string;
  fuel_type: string;
  transmission: string;
  description: string;
  is_active: boolean;
};

const BUCKET = "car-images";

// Keep these aligned with your UI promise (JPG/PNG/WebP)
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_EXT = new Set(["jpg", "jpeg", "png", "webp"]);

function toStr(v: any) {
  return v === null || v === undefined ? "" : String(v);
}

function isIntString(s: string) {
  return /^[0-9]+$/.test(s.trim());
}

function isNumberString(s: string) {
  return /^[0-9]+(\.[0-9]+)?$/.test(s.trim());
}

function getFileExt(filename: string) {
  const i = filename.lastIndexOf(".");
  if (i < 0) return "jpg";
  return filename.slice(i + 1).toLowerCase();
}

function safeImageExt(ext: string) {
  return ALLOWED_EXT.has(ext) ? ext : "jpg";
}

function uuidLike(): string {
  // Browser-safe UUID
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildObjectPath(listingId: string, ext: string) {
  // IMPORTANT: keep a consistent prefix so Storage RLS can match it
  return `listings/${listingId}/${uuidLike()}.${ext}`;
}

function publicUrl(bucket: string, path: string) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

async function fetchListingImages(listingId: string) {
  const { data, error } = await supabase
    .from("listing_images")
    .select("id, listing_id, bucket, path, position")
    .eq("listing_id", listingId)
    .order("position", { ascending: true });

  if (error) throw error;
  return (data ?? []) as ListingImageRow[];
}

async function removeStorageObjects(bucket: string, paths: string[]) {
  if (!paths.length) return;
  const { error } = await supabase.storage.from(bucket).remove(paths);
  if (error) throw error;
}

async function deleteListingImageRows(ids: string[]) {
  if (!ids.length) return;
  const { error } = await supabase
    .from("listing_images")
    .delete()
    .in("id", ids);
  if (error) throw error;
}

async function updateImagePositions(
  rows: Array<{ id: string; position: number }>,
) {
  if (!rows.length) return;

  // If your schema allows, you can do an upsert; otherwise update one-by-one.
  // Upsert usually requires a unique constraint; safe fallback: individual updates.
  for (const r of rows) {
    const { error } = await supabase
      .from("listing_images")
      .update({ position: r.position })
      .eq("id", r.id);
    if (error) throw error;
  }
}

async function uploadFilesAndInsertRows(
  listingId: string,
  files: File[],
  startPosition: number,
) {
  if (!files.length) return;

  const inserted: Array<{ bucket: string; path: string; position: number }> =
    [];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const ext = safeImageExt(getFileExt(f.name));
    const path = buildObjectPath(listingId, ext);

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, f, {
        cacheControl: "3600",
        upsert: false,
        contentType: f.type || undefined,
      });

    if (uploadErr) throw uploadErr;

    inserted.push({ bucket: BUCKET, path, position: startPosition + i });
  }

  const payload = inserted.map((r) => ({
    listing_id: listingId,
    bucket: r.bucket,
    path: r.path,
    position: r.position,
  }));

  const { error: insertErr } = await supabase
    .from("listing_images")
    .insert(payload);
  if (insertErr) {
    // best-effort rollback storage
    try {
      await removeStorageObjects(
        BUCKET,
        inserted.map((x) => x.path),
      );
    } catch {
      // ignore rollback errors
    }
    throw insertErr;
  }
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      {children}
    </div>
  );
}

export function ListingForm({
  mode,
  listingId,
  initial,
  onCreated,
  onSaved,
}: Props) {
  const qc = useQueryClient();
  const isEdit = mode === "edit";

  const defaults: FormState = useMemo(
    () => ({
      make: toStr(initial?.make),
      model: toStr(initial?.model),
      zip_code: toStr((initial as any)?.zip_code),
      year: toStr(initial?.year),
      price: toStr(initial?.price),
      mileage: toStr(initial?.mileage),
      fuel_type: toStr(initial?.fuel_type),
      transmission: toStr(initial?.transmission),
      description: toStr(initial?.description),
      is_active: initial?.is_active ?? true,
    }),
    // re-init when switching listing
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initial?.id],
  );

  const [form, setForm] = useState<FormState>(defaults);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Images state:
  // - existingImages: DB rows from listing_images
  // - deletedImageIds: track which existing images the user removed
  // - pendingFiles: new files selected but not uploaded yet (uploaded on Save)
  const [existingImages, setExistingImages] = useState<ListingImageRow[]>([]);
  const [deletedImageIds, setDeletedImageIds] = useState<Set<string>>(
    new Set(),
  );
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  useEffect(() => setForm(defaults), [defaults]);

  // Load existing images in edit mode
  const imagesQuery = useQuery({
    queryKey: ["listing-images", listingId],
    queryFn: () => fetchListingImages(listingId!),
    enabled: isEdit && !!listingId,
  });

  useEffect(() => {
    if (imagesQuery.data) {
      setExistingImages(imagesQuery.data);
      setDeletedImageIds(new Set());
    }
  }, [imagesQuery.data]);

  // Catalog (optional): brands + models from the DB
  const brandsQuery = useQuery({
    queryKey: ["brands"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("id, name")
        .order("name", { ascending: true });
      if (error) return [];
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
    staleTime: 1000 * 60 * 10,
  });

  const selectedBrandId = useMemo(() => {
    const b = (brandsQuery.data ?? []).find((x) => x.name === form.make);
    return b?.id ?? null;
  }, [brandsQuery.data, form.make]);

  const modelsQuery = useQuery({
    queryKey: ["models", selectedBrandId],
    enabled: !!selectedBrandId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("models")
        .select("id, name")
        .eq("brand_id", selectedBrandId!)
        .order("name", { ascending: true });
      if (error) return [];
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
    staleTime: 1000 * 60 * 10,
  });

  const visibleExisting = useMemo(
    () => existingImages.filter((img) => !deletedImageIds.has(img.id)),
    [existingImages, deletedImageIds],
  );

  const previewPending = useMemo(
    () =>
      pendingFiles.map((f) => ({
        file: f,
        url: URL.createObjectURL(f),
      })),
    [pendingFiles],
  );

  useEffect(() => {
    return () => previewPending.forEach((p) => URL.revokeObjectURL(p.url));
  }, [previewPending]);

  const validate = (): string | null => {
    if (!form.make.trim()) return "Make is required.";
    if (!form.model.trim()) return "Model is required.";
    if (!form.year.trim() || !isIntString(form.year))
      return "Year must be a whole number.";
    if (!form.price.trim() || !isNumberString(form.price))
      return "Price must be a number.";
    if (!form.mileage.trim() || !isIntString(form.mileage))
      return "Mileage must be a whole number.";
    if (!form.fuel_type.trim()) return "Fuel type is required.";
    if (!form.transmission.trim()) return "Transmission is required.";
    if (isEdit && !listingId) return "Missing listing id for edit.";
    return null;
  };

  const pickFiles = (list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list).filter((f) => ALLOWED_MIME.has(f.type));
    if (!incoming.length) {
      setErrorMsg("Please select JPG, PNG, or WebP images.");
      return;
    }
    setErrorMsg(null);
    setPendingFiles((prev) => [...prev, ...incoming]);
  };

  const removePendingAt = (idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const movePending = (from: number, to: number) => {
    setPendingFiles((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
  };

  const markExistingDeleted = (id: string) => {
    setDeletedImageIds((prev) => new Set(prev).add(id));
  };

  const moveExisting = (from: number, to: number) => {
    setExistingImages((prev) => {
      // reorder across the full array, but preserve "deleted" flags
      const visibleIdxs = prev
        .map((x, i) => ({ x, i }))
        .filter(({ x }) => !deletedImageIds.has(x.id))
        .map(({ i }) => i);

      if (from < 0 || from >= visibleIdxs.length) return prev;
      if (to < 0 || to >= visibleIdxs.length) return prev;

      const fromIdx = visibleIdxs[from];
      const toIdx = visibleIdxs[to];

      const next = [...prev];
      const [it] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, it);
      return next;
    });
  };

  const mutation = useMutation({
    mutationFn: async () => {
      setErrorMsg(null);

      const v = validate();
      if (v) throw new Error(v);

      // Listing payload
      // Location: store ZIP + precomputed lat/lng for fast radius search
      const zip = form.zip_code.trim();
      const ll = zip ? await geocodeZip(zip) : null;

      const payload = {
        make: form.make.trim(),
        model: form.model.trim(),
        zip_code: zip || null,
        lat: ll?.lat ?? null,
        lng: ll?.lng ?? null,
        year: Number(form.year),
        price: Number(form.price),
        mileage: Number(form.mileage),
        fuel_type: form.fuel_type.trim(),
        transmission: form.transmission.trim(),
        description: form.description.trim() ? form.description.trim() : null,
        is_active: form.is_active,
      };

      if (!isEdit) {
        // Create
        const { data: userRes, error: userErr } = await supabase.auth.getUser();
        if (userErr) throw userErr;
        const user = userRes.user;
        if (!user)
          throw new Error("You must be logged in to create a listing.");

        const seller_id = user.id;

        const { data, error } = await supabase
          .from("listings")
          .insert({ ...payload, seller_id })
          .select("id")
          .single();

        if (error) throw error;

        const newId = data.id as string;

        // Upload selected images (cover = position 0)
        if (pendingFiles.length) {
          await uploadFilesAndInsertRows(newId, pendingFiles, 0);
        }

        return { id: newId, mode: "create" as const };
      }

      // Edit
      // 1) Update listing
      const { error: upErr } = await supabase
        .from("listings")
        .update(payload)
        .eq("id", listingId!);
      if (upErr) throw upErr;

      // 2) Delete removed existing images (DB + storage)
      const deletedIds = Array.from(deletedImageIds);
      if (deletedIds.length) {
        const toDelete = existingImages.filter((x) =>
          deletedImageIds.has(x.id),
        );
        // delete rows first or storage first — either is fine; this is safer for UI consistency
        await deleteListingImageRows(deletedIds);
        // best-effort storage cleanup (won't block if policies aren’t in place, but throws if it fails)
        const paths = toDelete
          .filter((x) => x.bucket === BUCKET)
          .map((x) => x.path);
        if (paths.length) await removeStorageObjects(BUCKET, paths);
      }

      // 3) Recompute positions for remaining existing images (visibleExisting order)
      // Note: existingImages state may include deleted; we compute the current visible order by position in array
      const remaining = existingImages.filter(
        (x) => !deletedImageIds.has(x.id),
      );
      // Ensure stable order as currently displayed (array order)
      const positionUpdates = remaining.map((img, idx) => ({
        id: img.id,
        position: idx,
      }));
      await updateImagePositions(positionUpdates);

      // 4) Upload pending files and append after existing images
      const startPos = remaining.length;
      if (pendingFiles.length) {
        await uploadFilesAndInsertRows(listingId!, pendingFiles, startPos);
      }

      return { id: listingId!, mode: "edit" as const };
    },
    onSuccess: async (res) => {
      // clear local image state
      setPendingFiles([]);
      setDeletedImageIds(new Set());

      // refresh cache
      await qc.invalidateQueries({ queryKey: ["listing-images", res.id] });
      await qc.invalidateQueries({ queryKey: ["listing-edit", res.id] });
      await qc.invalidateQueries({ queryKey: ["my-listings"] });

      if (res.mode === "create") onCreated?.(res.id);
      else onSaved?.();
    },
    onError: (err: any) => {
      setErrorMsg(err?.message ?? "Save failed.");
    },
  });

  const existingDisplay = useMemo(() => {
    const imgs = visibleExisting;
    // display order is state order; cover is index 0
    return imgs.map((img, idx) => ({
      ...img,
      idx,
      url: publicUrl(img.bucket, img.path),
      label: idx === 0 ? "Cover" : `#${idx + 1}`,
    }));
  }, [visibleExisting]);

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">
              {isEdit ? "Edit Listing" : "Create Listing"}
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              {isEdit
                ? "Update details and manage images."
                : "Enter details, choose images, then save."}
            </p>
          </div>

          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Saving…" : "Save"}
          </button>
        </div>

        {errorMsg ? (
          <div className="mt-4 text-sm text-red-300">{errorMsg}</div>
        ) : null}

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Make">
            {(brandsQuery.data ?? []).length ? (
              <select
                className="w-full bg-slate-800 rounded-lg px-3 py-2 text-white"
                value={form.make}
                onChange={(e) =>
                  setForm({ ...form, make: e.target.value, model: "" })
                }
              >
                <option value="">Select…</option>
                {(brandsQuery.data ?? []).map((b) => (
                  <option key={b.id} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="w-full bg-slate-800 rounded-lg px-3 py-2 text-white"
                value={form.make}
                onChange={(e) => setForm({ ...form, make: e.target.value })}
                placeholder="e.g., Toyota"
              />
            )}
          </Field>

          <Field label="Model">
            {(modelsQuery.data ?? []).length ? (
              <select
                className="w-full bg-slate-800 rounded-lg px-3 py-2 text-white"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
              >
                <option value="">Select…</option>
                {(modelsQuery.data ?? []).map((m) => (
                  <option key={m.id} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="w-full bg-slate-800 rounded-lg px-3 py-2 text-white"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder="e.g., Camry"
              />
            )}
          </Field>

          <Field label="ZIP Code">
            <input
              className="w-full bg-slate-800 rounded-lg px-3 py-2 text-white"
              value={form.zip_code}
              onChange={(e) => setForm({ ...form, zip_code: e.target.value })}
              inputMode="numeric"
              placeholder="e.g., 10001"
            />
          </Field>

          <Field label="Year">
            <input
              className="w-full bg-slate-800 rounded-lg px-3 py-2 text-white"
              value={form.year}
              onChange={(e) => setForm({ ...form, year: e.target.value })}
              inputMode="numeric"
              placeholder="e.g., 2020"
            />
          </Field>

          <Field label="Price">
            <input
              className="w-full bg-slate-800 rounded-lg px-3 py-2 text-white"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              inputMode="decimal"
              placeholder="e.g., 18500"
            />
          </Field>

          <Field label="Mileage">
            <input
              className="w-full bg-slate-800 rounded-lg px-3 py-2 text-white"
              value={form.mileage}
              onChange={(e) => setForm({ ...form, mileage: e.target.value })}
              inputMode="numeric"
              placeholder="e.g., 65000"
            />
          </Field>

          <Field label="Fuel Type">
            <select
              className="w-full bg-slate-800 rounded-lg px-3 py-2 text-white"
              value={form.fuel_type}
              onChange={(e) => setForm({ ...form, fuel_type: e.target.value })}
            >
              <option value="">Select…</option>
              <option value="Gasoline">Gasoline</option>
              <option value="Diesel">Diesel</option>
              <option value="Hybrid">Hybrid</option>
              <option value="Electric">Electric</option>
            </select>
          </Field>

          <Field label="Transmission">
            <select
              className="w-full bg-slate-800 rounded-lg px-3 py-2 text-white"
              value={form.transmission}
              onChange={(e) =>
                setForm({ ...form, transmission: e.target.value })
              }
            >
              <option value="">Select…</option>
              <option value="Automatic">Automatic</option>
              <option value="Manual">Manual</option>
              <option value="CVT">CVT</option>
              <option value="DCT">DCT</option>
            </select>
          </Field>

          <Field label="Active">
            <label className="flex items-center gap-2 text-slate-200">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) =>
                  setForm({ ...form, is_active: e.target.checked })
                }
              />
              Visible in marketplace
            </label>
          </Field>
        </div>

        <div className="mt-4">
          <Field label="Description (optional)">
            <textarea
              className="w-full bg-slate-800 rounded-lg px-3 py-2 text-white min-h-[120px]"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              placeholder="Condition, recent service, features, known issues..."
            />
          </Field>
        </div>

        {/* Images */}
        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="font-medium">Images</div>
              <div className="text-sm text-slate-400">
                JPG/PNG/WebP only. Images upload when you click{" "}
                <span className="text-slate-200">Save</span>.
              </div>
            </div>

            <label className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 cursor-pointer">
              Add images
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={(e) => pickFiles(e.target.files)}
              />
            </label>
          </div>

          {/* Existing images (edit) */}
          {isEdit ? (
            <div className="mt-4">
              {imagesQuery.isLoading ? (
                <div className="text-sm text-slate-400">Loading images…</div>
              ) : existingDisplay.length ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {existingDisplay.map((img, idx) => (
                    <div
                      key={img.id}
                      className="rounded-xl border border-slate-800 p-2"
                    >
                      <img
                        src={img.url}
                        className="w-full h-32 object-cover rounded-lg"
                        alt=""
                      />
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="text-xs text-slate-400">
                          {img.label}
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50"
                            onClick={() => moveExisting(idx, idx - 1)}
                            disabled={idx === 0}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50"
                            onClick={() => moveExisting(idx, idx + 1)}
                            disabled={idx === existingDisplay.length - 1}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="text-xs px-2 py-1 rounded bg-red-600/80 hover:bg-red-600"
                            onClick={() => markExistingDeleted(img.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-slate-400">No images yet.</div>
              )}
            </div>
          ) : null}

          {/* Pending uploads */}
          <div className="mt-4">
            {previewPending.length ? (
              <>
                <div className="text-sm text-slate-300 mb-2">
                  Ready to upload ({previewPending.length})
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {previewPending.map((p, idx) => (
                    <div
                      key={`${p.file.name}-${idx}`}
                      className="rounded-xl border border-slate-800 p-2"
                    >
                      <img
                        src={p.url}
                        className="w-full h-32 object-cover rounded-lg"
                        alt=""
                      />
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="text-xs text-slate-400">
                          {idx === 0 && !isEdit && !existingDisplay.length
                            ? "Cover"
                            : `+${idx + 1}`}
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50"
                            onClick={() => movePending(idx, idx - 1)}
                            disabled={idx === 0}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50"
                            onClick={() => movePending(idx, idx + 1)}
                            disabled={idx === previewPending.length - 1}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="text-xs px-2 py-1 rounded bg-red-600/80 hover:bg-red-600"
                            onClick={() => removePendingAt(idx)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500 truncate">
                        {p.file.name}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-2 text-xs text-slate-400">
                  Tip: the first image becomes the cover (after
                  deletions/reorder), then the rest follow.
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-400">
                No new images selected.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
