import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";

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
  created_at?: string;
};

type Mode = "create" | "edit";

type Props = {
  mode: Mode;
  initial?: Partial<ListingRow>;
  listingId?: string; // required for edit
  showImages?: boolean; // show uploader in edit mode
  onCreated?: (listingId: string) => void;
  onSaved?: () => void;
};

type FormState = {
  make: string;
  model: string;
  year: string;
  price: string;
  mileage: string;
  fuel_type: string;
  transmission: string;
  description: string;
  is_active: boolean;
};

const BUCKET = "car-images";

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
  const parts = filename.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "jpg";
}

function safeImageExt(ext: string) {
  const allowed = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
  return allowed.has(ext) ? ext : "jpg";
}

function buildObjectPath(listingId: string, ext: string) {
  // Keep consistent with ListingImageUploader.tsx
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `listings/${listingId}/${id}.${ext}`;
}

async function uploadFilesForListing(listingId: string, files: File[]) {
  if (!files.length) return;

  const uploadedRows: Array<{
    bucket: string;
    path: string;
    position: number;
  }> = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const ext = safeImageExt(getFileExt(file.name));
    const path = buildObjectPath(listingId, ext);

    // NOTE: Supabase Storage accepts File directly; no FileReader required.
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
      position: i, // cover is position 0
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
}

export function ListingForm({
  mode,
  initial,
  listingId,
  showImages = false,
  onCreated,
  onSaved,
}: Props) {
  const defaults: FormState = useMemo(
    () => ({
      make: toStr(initial?.make),
      model: toStr(initial?.model),
      year: toStr(initial?.year),
      price: toStr(initial?.price),
      mileage: toStr(initial?.mileage),
      fuel_type: toStr(initial?.fuel_type),
      transmission: toStr(initial?.transmission),
      description: toStr(initial?.description),
      is_active: initial?.is_active ?? true,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initial?.id],
  );

  const [form, setForm] = useState<FormState>(defaults);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Create-mode: user can pick images before listing exists; we upload after Save.
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  useEffect(() => setForm(defaults), [defaults]);
  useEffect(() => {
    // If user switches listings or mode changes, clear create-mode file selection
    if (mode !== "create") setPendingFiles([]);
  }, [mode, initial?.id]);

  const validate = (): string | null => {
    if (!form.make.trim()) return "Make is required.";
    if (!form.model.trim()) return "Model is required.";

    if (!form.year.trim()) return "Year is required.";
    if (!isIntString(form.year)) return "Year must be a whole number.";

    if (!form.price.trim()) return "Price is required.";
    if (!isNumberString(form.price)) return "Price must be a number.";

    if (!form.mileage.trim()) return "Mileage is required.";
    if (!isIntString(form.mileage)) return "Mileage must be a whole number.";

    if (!form.fuel_type.trim()) return "Fuel type is required.";
    if (!form.transmission.trim()) return "Transmission is required.";

    if (mode === "edit" && !listingId) return "Missing listing id for edit.";
    return null;
  };

  const mutation = useMutation({
    mutationFn: async () => {
      setErrorMsg(null);

      const v = validate();
      if (v) throw new Error(v);

      const payload = {
        make: form.make.trim(),
        model: form.model.trim(),
        year: Number(form.year),
        price: Number(form.price),
        mileage: Number(form.mileage),
        fuel_type: form.fuel_type.trim(),
        transmission: form.transmission.trim(),
        description: form.description.trim() ? form.description.trim() : null,
        is_active: form.is_active,
      };

      if (mode === "create") {
        const { data: userRes, error: userErr } = await supabase.auth.getUser();
        if (userErr) throw userErr;
        if (!userRes?.user) {
          throw new Error("You must be logged in to create a listing.");
        }

        const seller_id = userRes.user.id;

        // 1) Create listing row
        const { data, error } = await supabase
          .from("listings")
          .insert({ ...payload, seller_id })
          .select("id")
          .single();

        if (error) throw error;

        const newId = data.id as string;

        // 2) Upload any pre-selected images
        if (pendingFiles.length) {
          await uploadFilesForListing(newId, pendingFiles);
        }

        return { id: newId, mode };
      }

      // edit
      const { error } = await supabase
        .from("listings")
        .update(payload)
        .eq("id", listingId!);

      if (error) throw error;

      return { id: listingId!, mode };
    },
    onSuccess: (res) => {
      if (res.mode === "create") {
        setPendingFiles([]);
        onCreated?.(res.id);
      } else {
        onSaved?.();
      }
    },
    onError: (err: any) => {
      setErrorMsg(err?.message ?? "Save failed.");
    },
  });

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">
              {mode === "create" ? "Create Listing" : "Edit Listing"}
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              {mode === "create"
                ? "Enter details and (optionally) choose photos. Photos upload when you save."
                : "Update details and manage images."}
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
            <input
              className="w-full bg-slate-800 rounded-lg px-3 py-2 text-white"
              value={form.make}
              onChange={(e) => setForm({ ...form, make: e.target.value })}
              placeholder="e.g., Toyota"
            />
          </Field>

          <Field label="Model">
            <input
              className="w-full bg-slate-800 rounded-lg px-3 py-2 text-white"
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="e.g., Camry"
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

        {/* Create mode: select images now, upload on Save */}
        {mode === "create" ? (
          <div className="mt-6">
            <ListingImagePicker
              files={pendingFiles}
              onChange={setPendingFiles}
            />
            <div className="mt-2 text-xs text-slate-400">
              Tip: the first image is treated as the cover photo.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
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

function ListingImagePicker({
  files,
  onChange,
}: {
  files: File[];
  onChange: (files: File[]) => void;
}) {
  const previews = useMemo(
    () =>
      files.map((f) => ({
        file: f,
        url: URL.createObjectURL(f),
      })),
    [files],
  );

  useEffect(() => {
    return () => {
      for (const p of previews) URL.revokeObjectURL(p.url);
    };
  }, [previews]);

  const onPick = (list: FileList | null) => {
    if (!list) return;
    const incoming = Array.from(list).filter((f) =>
      f.type.startsWith("image/"),
    );
    onChange([...files, ...incoming]);
  };

  const removeAt = (idx: number) => {
    onChange(files.filter((_, i) => i !== idx));
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= files.length) return;
    const next = [...files];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onChange(next);
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="font-medium">Photos</div>
          <div className="text-sm text-slate-400">
            Choose images now. They’ll upload when you save the listing.
          </div>
        </div>

        <label className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 cursor-pointer">
          Add images
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => onPick(e.target.files)}
          />
        </label>
      </div>

      {previews.length ? (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {previews.map((p, idx) => (
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
                  {idx === 0 ? "Cover" : `#${idx + 1}`}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50"
                    onClick={() => move(idx, idx - 1)}
                    disabled={idx === 0}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50"
                    onClick={() => move(idx, idx + 1)}
                    disabled={idx === previews.length - 1}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="text-xs px-2 py-1 rounded bg-red-600/80 hover:bg-red-600"
                    onClick={() => removeAt(idx)}
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
      ) : (
        <div className="mt-4 text-sm text-slate-400">No images selected.</div>
      )}
    </div>
  );
}
