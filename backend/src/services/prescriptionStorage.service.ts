import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";

export type StoredPrescriptionDocument = {
  key: string;
  content: Buffer;
  contentType: string;
};

export interface PrescriptionStorage {
  upload(document: StoredPrescriptionDocument): Promise<void>;
  delete(key: string): Promise<void>;
  createSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
}

function storageUnavailableError() {
  return new ApiError(
    503,
    "Prescription document storage is unavailable.",
    "PRESCRIPTION_STORAGE_UNAVAILABLE",
  );
}

function storageOperationError() {
  return new ApiError(
    502,
    "Prescription document storage operation failed.",
    "PRESCRIPTION_STORAGE_ERROR",
  );
}

class SupabasePrescriptionStorage implements PrescriptionStorage {
  private client: SupabaseClient | undefined;

  private getConfiguration() {
    if (
      !env.supabaseUrl ||
      !env.supabaseServiceRoleKey ||
      !env.supabasePrescriptionsBucket
    ) {
      throw storageUnavailableError();
    }

    this.client ??= createClient(
      env.supabaseUrl,
      env.supabaseServiceRoleKey,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );

    return {
      client: this.client,
      bucket: env.supabasePrescriptionsBucket,
    };
  }

  async upload(document: StoredPrescriptionDocument) {
    const { client, bucket } = this.getConfiguration();
    const { error } = await client.storage.from(bucket).upload(
      document.key,
      document.content,
      {
        contentType: document.contentType,
        upsert: false,
      },
    );

    if (error) throw storageOperationError();
  }

  async delete(key: string) {
    const { client, bucket } = this.getConfiguration();
    const { error } = await client.storage.from(bucket).remove([key]);
    if (error) throw storageOperationError();
  }

  async createSignedUrl(key: string, expiresInSeconds: number) {
    const { client, bucket } = this.getConfiguration();
    const { data, error } = await client.storage
      .from(bucket)
      .createSignedUrl(key, expiresInSeconds);

    if (error || !data?.signedUrl) throw storageOperationError();
    return data.signedUrl;
  }
}

export const prescriptionStorage: PrescriptionStorage =
  new SupabasePrescriptionStorage();
