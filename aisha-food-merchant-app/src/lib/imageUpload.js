import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";

import { getApiUrl } from "@/src/lib/api";
import { getToken } from "@/src/lib/session";

const SUPPORTED_UPLOAD_TYPES = new Set(["merchant_logo", "product_image"]);

function createUploadError(message, extra = {}) {
  const error = new Error(message);
  Object.assign(error, extra);
  return error;
}

function normalizeAsset(asset) {
  if (!asset?.uri) return null;
  const mimeType = String(asset.mimeType || "image/jpeg").trim().toLowerCase();
  const fileName =
    String(asset.fileName || "").trim() ||
    `upload-${Date.now()}.${mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg"}`;

  return {
    uri: String(asset.uri),
    mimeType,
    fileName,
    width: Number(asset.width || 0) || null,
    height: Number(asset.height || 0) || null,
    fileSize: Number(asset.fileSize || 0) || null,
  };
}

export async function pickImage(options = {}) {
  const source = options.source === "camera" ? "camera" : "library";
  const aspect = Array.isArray(options.aspect) && options.aspect.length === 2 ? options.aspect : [1, 1];
  const allowsEditing = options.allowsEditing !== false;

  if (source === "camera") {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw createUploadError("Camera permission is required to take a photo.", {
        code: "CAMERA_PERMISSION_REQUIRED",
      });
    }
  } else {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw createUploadError("Gallery permission is required to choose a photo.", {
        code: "GALLERY_PERMISSION_REQUIRED",
      });
    }
  }

  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          allowsEditing,
          quality: 0.9,
          aspect,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing,
          quality: 0.9,
          aspect,
        });

  if (result.canceled || !Array.isArray(result.assets) || !result.assets[0]) {
    return null;
  }

  return normalizeAsset(result.assets[0]);
}

export async function compressImage(uri) {
  const safeUri = String(uri || "").trim();
  if (!safeUri) {
    throw createUploadError("Image uri is missing.", { code: "MISSING_IMAGE_URI" });
  }

  const result = await ImageManipulator.manipulateAsync(
    safeUri,
    [{ resize: { width: 1200 } }],
    {
      compress: 0.7,
      format: ImageManipulator.SaveFormat.JPEG,
    }
  );

  return {
    uri: result.uri,
    mimeType: "image/jpeg",
    fileName: `upload-${Date.now()}.jpg`,
    width: result.width,
    height: result.height,
  };
}

export async function uploadImage(file, type) {
  const uploadType = String(type || "").trim();
  if (!SUPPORTED_UPLOAD_TYPES.has(uploadType)) {
    throw createUploadError("Invalid upload type.", { code: "INVALID_UPLOAD_TYPE" });
  }

  const token = await getToken();
  if (!token) {
    throw createUploadError("You are not signed in. Please log in again.", {
      code: "MISSING_TOKEN",
      status: 401,
    });
  }

  const safeFile = normalizeAsset(file) || {
    uri: String(file?.uri || "").trim(),
    mimeType: String(file?.mimeType || "image/jpeg").trim().toLowerCase(),
    fileName: String(file?.fileName || `upload-${Date.now()}.jpg`).trim(),
  };

  if (!safeFile.uri) {
    throw createUploadError("No image selected.", { code: "MISSING_FILE" });
  }

  const formData = new FormData();
  formData.append("type", uploadType);
  formData.append("image", {
    uri: safeFile.uri,
    name: safeFile.fileName,
    type: safeFile.mimeType || "image/jpeg",
  });

  let response;
  try {
    response = await fetch(`${getApiUrl()}/api/uploads/image`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });
  } catch {
    throw createUploadError(
      "Cannot connect to OranjeEats server. Check EXPO_PUBLIC_API_URL and backend.",
      { code: "NETWORK_ERROR", status: 0 }
    );
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    throw createUploadError("Upload failed. Try again.", {
      code: "INVALID_RESPONSE",
      status: response.status,
    });
  }

  if (!response.ok || payload?.ok === false || payload?.success === false) {
    const code = String(payload?.error?.code || payload?.code || "").trim().toUpperCase();
    const message =
      payload?.error?.message ||
      payload?.message ||
      (response.status === 413
        ? "Image too large. Choose a lighter photo."
        : response.status === 400 && code === "INVALID_IMAGE_TYPE"
          ? "Unsupported image format. Use JPG, PNG or WEBP."
          : "Upload failed. Try again.");
    throw createUploadError(message, {
      code: code || "UPLOAD_FAILED",
      status: response.status,
    });
  }

  const imageUrl = String(payload?.imageUrl || "").trim();
  if (!imageUrl) {
    throw createUploadError("Upload succeeded but no image URL was returned.", {
      code: "MISSING_IMAGE_URL",
      status: response.status,
    });
  }

  return imageUrl;
}
