
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { storage } from "./firebase";
import { Attachment } from "@/types";

// Configuration for compression
const MAX_WIDTH = 1200; // px
const MAX_HEIGHT = 1200; // px
const QUALITY = 0.8;
const MAX_SIZE_MB = 5;

/**
 * Compresses an image file using browser Canvas API.
 * Converts to WebP for better compression.
 */
export const compressImage = async (file: File): Promise<Blob> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(img.src);

            let width = img.width;
            let height = img.height;

            // Calculate new dimensions while maintaining aspect ratio
            if (width > height) {
                if (width > MAX_WIDTH) {
                    height = Math.round((height * MAX_WIDTH) / width);
                    width = MAX_WIDTH;
                }
            } else {
                if (height > MAX_HEIGHT) {
                    width = Math.round((width * MAX_HEIGHT) / height);
                    height = MAX_HEIGHT;
                }
            }

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");

            if (!ctx) {
                reject(new Error("Failed to get canvas context"));
                return;
            }

            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob(
                (blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error("Compression failed"));
                    }
                },
                "image/webp",
                QUALITY
            );
        };
        img.onerror = (error) => reject(error);
    });
};

/**
 * Uploads a file to Firebase Storage.
 * Handles compression if it is an image.
 */
export const uploadTaskAttachment = async (file: File, userId: string): Promise<Attachment> => {
    if (!storage) throw new Error("Firebase Storage is not initialized");

    // Validate file size (before compression check)
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
        throw new Error(`File size exceeds ${MAX_SIZE_MB}MB limit.`);
    }

    const isImage = file.type.startsWith("image/");
    let uploadData: Blob | File = file;
    let mimeType = file.type;
    let fileName = file.name;

    // Compress images
    if (isImage) {
        try {
            const compressedBlob = await compressImage(file);
            uploadData = compressedBlob;
            mimeType = "image/webp";
            fileName = fileName.replace(/\.[^/.]+$/, "") + ".webp";
        } catch (error) {
            console.warn("Image compression failed, uploading original:", error);
        }
    }

    // Create a storage reference
    // Path structure: users/{userId}/attachments/{uuid}.{ext}
    const fileId = crypto.randomUUID();
    const storagePath = `users/${userId}/attachments/${fileId}_${fileName}`;
    const storageRef = ref(storage, storagePath);

    // Upload
    const snapshot = await uploadBytes(storageRef, uploadData, {
        contentType: mimeType,
        cacheControl: 'public, max-age=31536000', // Cache for 1 year
    });

    // Get URL
    const downloadURL = await getDownloadURL(snapshot.ref);

    return {
        id: fileId,
        url: downloadURL,
        path: storagePath,
        name: fileName,
        type: isImage ? 'image' : 'file',
        size: snapshot.metadata.size,
        createdAt: Date.now(),
    };
};

/**
 * Deletes a file from Firebase Storage.
 */
export const deleteAttachment = async (path: string): Promise<void> => {
    if (!storage) throw new Error("Firebase Storage is not initialized");
    const storageRef = ref(storage, path);
    try {
        await deleteObject(storageRef);
    } catch (error: any) {
        if (error.code === 'storage/object-not-found') {
            console.warn("File not found, skipping delete:", path);
            return;
        }
        throw error;
    }
};
