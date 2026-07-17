import * as FileSystem from "expo-file-system/legacy";

import { describeHttpError } from "@/api/api-errors";
import {
  API_CONNECTION_ERROR_MESSAGE,
  apiClient,
  getApiAuthHeaders,
  resolveReachableApiUrlCandidates,
} from "@/api/client";
import type { GlobalImageTemplateRead, UUID } from "@/types/api";

const SUPER_ADMIN_PREFIX = "/api/v1/super-admin";
const ADMIN_PREFIX = "/api/v1/admin";

export type GlobalImageTemplateImageUploadFile = {
  uri: string;
  name: string;
  type: string;
};

export type GlobalImageTemplateCreateFields = {
  name: string;
  sort_order?: number;
  is_active?: boolean;
  category_id?: UUID | null;
};

export type GlobalImageTemplateUpdateFields = {
  name?: string;
  sort_order?: number;
  is_active?: boolean;
  category_id?: UUID | null;
  remove_image?: boolean;
};

function parseUploadResponseBody(body: string) {
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    return {};
  }
}

function getUploadResponseMessage(body: unknown) {
  if (!body || typeof body !== "object") {
    return "";
  }
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === "string") {
    return detail;
  }
  const message = (body as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

async function assertUploadFileReady(file: GlobalImageTemplateImageUploadFile) {
  const info = await FileSystem.getInfoAsync(file.uri);
  if (!info.exists || info.isDirectory) {
    throw new Error("Selected image file is no longer available. Pick the image again and save.");
  }
}

function fieldsToParameters(fields: Record<string, string | number | boolean | null | undefined>) {
  const parameters: Record<string, string> = {};
  Object.entries(fields).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }
    parameters[key] = String(value);
  });
  return parameters;
}

async function uploadGlobalImageTemplateMultipart<TResponse>(
  path: string,
  httpMethod: "POST" | "PATCH",
  fields: Record<string, string | number | boolean | null | undefined>,
  file?: GlobalImageTemplateImageUploadFile | null,
) {
  const uploadUrls = await resolveReachableApiUrlCandidates(path);
  if (uploadUrls.length === 0) {
    throw new Error(API_CONNECTION_ERROR_MESSAGE);
  }
  if (file) {
    await assertUploadFileReady(file);
  }

  const parameters = fieldsToParameters(fields);
  let lastNetworkError: unknown = null;

  for (const [index, uploadUrl] of uploadUrls.entries()) {
    try {
      if (file) {
        const response = await FileSystem.uploadAsync(uploadUrl, file.uri, {
          fieldName: "image",
          headers: {
            Accept: "application/json",
            ...getApiAuthHeaders(),
          },
          httpMethod,
          mimeType: file.type,
          parameters,
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        });
        const body = parseUploadResponseBody(response.body);
        if (response.status >= 200 && response.status < 300) {
          return body as TResponse;
        }
        throw new Error(
          getUploadResponseMessage(body) ||
            describeHttpError(response.status, "Unable to upload the image. Please try again."),
        );
      }

      const formData = new FormData();
      Object.entries(parameters).forEach(([key, value]) => {
        formData.append(key, value);
      });
      const { data } = await apiClient.request<TResponse>({
        url: path,
        method: httpMethod,
        data: formData,
      });
      return data;
    } catch (error) {
      lastNetworkError = error;
      if (index < uploadUrls.length - 1) {
        continue;
      }
    }
  }

  if (lastNetworkError instanceof Error && lastNetworkError.message) {
    throw lastNetworkError;
  }
  throw new Error(API_CONNECTION_ERROR_MESSAGE);
}

export async function fetchAdminGlobalImageTemplates() {
  const { data } = await apiClient.get<GlobalImageTemplateRead[]>(`${ADMIN_PREFIX}/global-image-templates`);
  return data;
}

export async function fetchSuperAdminGlobalImageTemplates(includeInactive = true) {
  const { data } = await apiClient.get<GlobalImageTemplateRead[]>(`${SUPER_ADMIN_PREFIX}/global-image-templates`, {
    params: includeInactive ? { active_only: true } : undefined,
  });
  return data;
}

export async function createSuperAdminGlobalImageTemplate(
  fields: GlobalImageTemplateCreateFields,
  file?: GlobalImageTemplateImageUploadFile | null,
) {
  return uploadGlobalImageTemplateMultipart<GlobalImageTemplateRead>(
    `${SUPER_ADMIN_PREFIX}/global-image-templates`,
    "POST",
    {
      name: fields.name,
      sort_order: fields.sort_order ?? 0,
      is_active: fields.is_active ?? true,
      category_id: fields.category_id ?? null,
    },
    file,
  );
}

export async function updateSuperAdminGlobalImageTemplate(
  templateId: UUID,
  fields: GlobalImageTemplateUpdateFields,
  file?: GlobalImageTemplateImageUploadFile | null,
) {
  return uploadGlobalImageTemplateMultipart<GlobalImageTemplateRead>(
    `${SUPER_ADMIN_PREFIX}/global-image-templates/${templateId}`,
    "PATCH",
    fields,
    file,
  );
}

export async function deactivateSuperAdminGlobalImageTemplate(templateId: UUID) {
  const { data } = await apiClient.delete<GlobalImageTemplateRead>(
    `${SUPER_ADMIN_PREFIX}/global-image-templates/${templateId}`,
  );
  return data;
}
