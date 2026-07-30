import { describe, expect, it } from "vitest";
import {
  listingFileKind,
  validateListingFiles,
} from "@/lib/listingFiles";

const file = (name: string, type: string, size = 10) =>
  new File([new Uint8Array(size)], name, { type, lastModified: 1 });

describe("listing file validation", () => {
  it("accepts the supported image formats and PDF documents", () => {
    expect(listingFileKind(file("photo.jpg", "image/jpeg"))).toBe("image");
    expect(listingFileKind(file("photo.png", "image/png"))).toBe("image");
    expect(listingFileKind(file("photo.webp", "image/webp"))).toBe("image");
    expect(listingFileKind(file("receipt.pdf", "application/pdf"))).toBe("document");
  });

  it("rejects mismatched extensions and unsupported types", () => {
    expect(listingFileKind(file("fake.pdf", "image/png"))).toBeNull();
    expect(listingFileKind(file("notes.txt", "text/plain"))).toBeNull();
  });

  it("enforces existing-file count limits", () => {
    const result = validateListingFiles(
      [
        file("seventh.jpg", "image/jpeg"),
        file("third.pdf", "application/pdf"),
      ],
      { images: 6, documents: 2 },
    );
    expect(result.accepted).toHaveLength(0);
    expect(result.errors).toEqual([
      "seventh.jpg: a listing can have at most 6 images",
      "third.pdf: a listing can have at most 2 PDF documents",
    ]);
  });
});
