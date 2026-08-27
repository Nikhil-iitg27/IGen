const STORAGE_KEY = "igen_image_gallery";
const MAX_IMAGES = 5;
export const GALLERY_EVENT = "igen:gallery-updated";

function notify() {
  window.dispatchEvent(new Event(GALLERY_EVENT));
}

/**
 * Last-5 generated/inpainted images, persisted in localStorage so they
 * survive a tab switch (component unmount) or a full reload -- neither
 * of which anything in React state alone survives.
 */
export function getImages() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error("Error reading image gallery:", err);
    return [];
  }
}

export function saveImage(dataUrl, meta = {}) {
  if (!dataUrl) return null;
  try {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      dataUrl,
      savedAt: Date.now(),
      ...meta,
    };
    const next = [entry, ...getImages()].slice(0, MAX_IMAGES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    notify();
    return entry;
  } catch (err) {
    // localStorage can throw (quota exceeded, private-browsing storage
    // blocked, etc.) -- a failed save shouldn't break the generation
    // flow that triggered it, just log and move on.
    console.error("Error saving image to gallery:", err);
    return null;
  }
}

export function clearImages() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    notify();
  } catch (err) {
    console.error("Error clearing image gallery:", err);
  }
}
