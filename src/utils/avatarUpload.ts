import { isValidAvatarDataUrl } from './sessionAndOverrides';

/**
 * Compresses an uploaded image File into a 160x160 center-cropped JPEG data URL
 * strictly under 70KB so it persists seamlessly in LocalStorage, IndexedDB, and Firestore.
 */
export async function compressAvatarFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a valid image file (PNG, JPG, or WEBP).');
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error('Image file is larger than 12MB. Please select a smaller photo.');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode selected image file.'));
      el.src = objectUrl;
    });

    const size = 160;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas image processing is unavailable in this browser.');
    }

    const srcMin = Math.min(img.naturalWidth || size, img.naturalHeight || size);
    const sx = Math.max(0, ((img.naturalWidth || size) - srcMin) / 2);
    const sy = Math.max(0, ((img.naturalHeight || size) - srcMin) / 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, sx, sy, srcMin, srcMin, 0, 0, size, size);

    for (const quality of [0.8, 0.65, 0.5, 0.35]) {
      const candidate = canvas.toDataURL('image/jpeg', quality);
      if (isValidAvatarDataUrl(candidate)) {
        return candidate;
      }
    }
    throw new Error('Selected photo is too complex to compress cleanly. Try another image.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
