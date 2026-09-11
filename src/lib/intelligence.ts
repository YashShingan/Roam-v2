// ─── Place Intelligence Engine ───────────────────────────────────────────────
// Identifies and filters junk (budget chain accommodations, camera file dumps,
// timestamps), cleans photo titles to canonical landmark names, and verifies
// category classification.

/** Patterns identifying budget chain hotels, lodge rooms, and non-attraction stays */
export const JUNK_ACCOMMODATION_RE =
  /\b(?:oyo|spot\s*on|capital\s*o|collection\s*o|townhouse|fabhotel|treebo)\b|\b\d{3,6}\b.*(?:stay|inn|hotel|rooms?|residency)|\b(?:hotel|lodge|lodging|rooms?|homestay|residency|pg|guest\s*house|dharamshala)\s+(?:rooms?|stay|deluxe|suite|executive|inn)|\b(?:dormitory|pg\s+for\s+(?:men|women|gents|ladies)|paying\s*guest)\b/i;

/** Patterns identifying raw photo dumps, camera file names, timestamps, and photo numbers */
export const CAMERA_OR_FILE_NOISE_RE =
  /^(?:img|dsc|photo|picture|panorama|pano|image|screenshot|file)[\s\d_-]*$/i;

/** Timestamp / date suffixes on photo files (e.g. "- June 2019 (2)", "5-11-2008 11-06-48 AM") */
const TIMESTAMP_SUFFIX_RE =
  /\s*[-–—]\s*(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}(?:\s*\(\d+\))?.*$/i;

const NUMERIC_DATE_TIME_RE =
  /\s*[-–—]?\s*\b\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}(?:\s+\d{1,2}[-:]\d{2}(?:[-:]\d{2})?\s*(?:am|pm)?)?.*$/i;

const TIME_ONLY_RE =
  /\s+\d{1,2}[-:]\d{2}(?:[-:]\d{2})?\s*(?:am|pm)?$/i;

const PHOTO_SUFFIX_RE =
  /\s*(?:in\s+(?:the\s+)?(?:night|evening|morning|day|rain|fog|snow|sunset|sunrise)|near\s+building[\w\s-]*|view\s+from[\w\s-]*)\s*\d*$/i;

const SEQUENCE_NOISE_RE =
  /(?:[-_\s]+\d{1,3}|\s*\(\d{1,3}\)|\s+#\d{1,3})$/;

const GEOGRAPHIC_SUFFIX_CLEAN_RE =
  /[-_\s]+(?:bangalore|bengaluru|mumbai|pune|delhi|india|karnataka|maharashtra)[-\w\s]*$/i;

/**
 * Normalizes a mined name (especially from Wikimedia Commons or photo sources)
 * to its canonical landmark or place name.
 * e.g. "Vidhana Soudha - June 2019 (2)" -> "Vidhana Soudha"
 * e.g. "Vidhan Soudha 5-11-2008 11-06-48 AM" -> "Vidhana Soudha"
 * e.g. "Cubbon park-1-bangalore-India" -> "Cubbon Park"
 * e.g. "Wooden Castle Cubbon Park 01" -> "Cubbon Park" or "Wooden Castle Cubbon Park"
 */
export function extractCanonicalLandmark(rawTitle: string): string {
  let name = rawTitle.replace(/^File:/i, "").trim();
  // Strip image file extensions
  name = name.replace(/\.(?:jpe?g|png|webp|tiff?|gif|svg)$/i, "").trim();
  // Replace underscores and clean separator spacing
  name = name.replace(/_/g, " ").replace(/\s+/g, " ");

  // Strip timestamp suffixes: "Vidhana Soudha - June 2019 (2)" -> "Vidhana Soudha"
  name = name.replace(TIMESTAMP_SUFFIX_RE, "");
  // Strip numeric date & time: "Vidhan Soudha 5-11-2008 11-06-48 AM" -> "Vidhan Soudha"
  name = name.replace(NUMERIC_DATE_TIME_RE, "");
  name = name.replace(TIME_ONLY_RE, "");

  // Strip photo conditions: "Vidhana Soudha in night 3" -> "Vidhana Soudha"
  name = name.replace(PHOTO_SUFFIX_RE, "");

  // Strip geo suffix tails: "Cubbon park-1-bangalore-India" -> "Cubbon park"
  name = name.replace(GEOGRAPHIC_SUFFIX_CLEAN_RE, "");

  // Strip trailing sequence numbers: "Vikas Soudha 1" -> "Vikas Soudha", " 01" -> ""
  name = name.replace(SEQUENCE_NOISE_RE, "");

  // Standardize common Indian landmark variations (e.g. Vidhan -> Vidhana)
  name = name.replace(/\bVidhan\s+Soudha\b/i, "Vidhana Soudha");

  // Title-case words: "Cubbon park" -> "Cubbon Park"
  name = name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

  return name.trim();
}

/**
 * Checks if a candidate place is undesirable noise:
 * - Budget hotel rooms (OYO / SPOT ON)
 * - Camera file dump names (IMG_2020..., DSC_001...)
 * - Inscriptions / rock edict photo records (unless a recognized monument)
 * - Single-character / pure digit names
 */
export function isJunkPlace(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 3) return true;
  if (/^\d+$/.test(trimmed)) return true;
  if (CAMERA_OR_FILE_NOISE_RE.test(trimmed)) return true;
  if (JUNK_ACCOMMODATION_RE.test(trimmed)) return true;

  // Inscriptions from photo archives that aren't visitable tourist places
  if (/^inscription\s+of\s+/i.test(trimmed) || /^(?:hero\s*stone|nandi\s*stone|inscription\s*stone)\b/i.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Prevents misclassifying hotels / commercial stays as Culture or Nature
 */
export function sanitizeCategory(category: string, name: string): string {
  if (JUNK_ACCOMMODATION_RE.test(name) || /\b(?:hotel|lodge|rooms?|inn|resort|homestay|stay)\b/i.test(name)) {
    // If it's accommodation that wasn't filtered, it definitely isn't culture or nature
    return "hidden_gem";
  }
  return category;
}
