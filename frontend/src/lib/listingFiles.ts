export const MAX_LISTING_IMAGES = 6;
export const MAX_LISTING_DOCUMENTS = 2;
export const MAX_LISTING_IMAGE_SIZE = 10 * 1024 * 1024;
export const MAX_LISTING_DOCUMENT_SIZE = 5 * 1024 * 1024;

const IMAGE_TYPES = new Map([
  ["image/jpeg", new Set([".jpg", ".jpeg"])],
  ["image/png", new Set([".png"])],
  ["image/webp", new Set([".webp"])],
]);

export interface ListingFile {
  id: number;
  listingId: number;
  originalName: string;
  kind: "image" | "document";
  mimeType: string;
  size: number;
  displayOrder: number;
  contentUrl: string;
  createdAt: string;
}

export interface FileValidationResult {
  accepted: File[];
  errors: string[];
}

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
};

export const listingFileKind = (
  file: Pick<File, "name" | "type">,
): "image" | "document" | null => {
  const extension = extensionOf(file.name);
  const imageExtensions = IMAGE_TYPES.get(file.type);
  if (imageExtensions?.has(extension)) return "image";
  if (file.type === "application/pdf" && extension === ".pdf") return "document";
  return null;
};

export const validateListingFiles = (
  files: File[],
  counts: { images: number; documents: number },
): FileValidationResult => {
  const accepted: File[] = [];
  const errors: string[] = [];
  let imageCount = counts.images;
  let documentCount = counts.documents;
  const seen = new Set<string>();

  for (const file of files) {
    const duplicateKey = `${file.name}:${file.size}:${file.lastModified}`;
    if (seen.has(duplicateKey)) {
      errors.push(`${file.name}: duplicate file`);
      continue;
    }
    seen.add(duplicateKey);

    if (file.size <= 0) {
      errors.push(`${file.name}: file is empty`);
      continue;
    }
    const kind = listingFileKind(file);
    if (!kind) {
      errors.push(`${file.name}: only JPEG, PNG, WebP and PDF files are allowed`);
      continue;
    }
    if (kind === "image") {
      if (file.size > MAX_LISTING_IMAGE_SIZE) {
        errors.push(`${file.name}: images must be 10MB or smaller`);
        continue;
      }
      if (imageCount >= MAX_LISTING_IMAGES) {
        errors.push(`${file.name}: a listing can have at most 6 images`);
        continue;
      }
      imageCount++;
    } else {
      if (file.size > MAX_LISTING_DOCUMENT_SIZE) {
        errors.push(`${file.name}: PDF documents must be 5MB or smaller`);
        continue;
      }
      if (documentCount >= MAX_LISTING_DOCUMENTS) {
        errors.push(`${file.name}: a listing can have at most 2 PDF documents`);
        continue;
      }
      documentCount++;
    }
    accepted.push(file);
  }

  return { accepted, errors };
};

export const uploadListingFiles = (
  listingId: number,
  files: File[],
  token: string,
  onProgress: (percent: number) => void,
): Promise<ListingFile[]> =>
  new Promise((resolve, reject) => {
    if (files.length === 0) {
      resolve([]);
      return;
    }
    const body = new FormData();
    files.forEach((file) => body.append("files", file));

    const request = new XMLHttpRequest();
    request.open("POST", `/api/v1/products/${listingId}/files`);
    request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onerror = () => reject(new Error("Network error while uploading files"));
    request.onload = () => {
      const response = (() => {
        try {
          return JSON.parse(request.responseText || "{}");
        } catch {
          return {};
        }
      })();
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve(Array.isArray(response.files) ? response.files : []);
      } else {
        reject(new Error(response.error || "Failed to upload listing files"));
      }
    };
    request.send(body);
  });

export const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
