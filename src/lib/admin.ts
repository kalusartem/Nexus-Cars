import { supabase } from "./supabase";

export async function fetchIsAdmin(userId: string | null) {
  if (!userId) return false;

  const { data, error } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();

  if (error) return false;
  return !!data?.is_admin;
}
