// Pure, dependency-free validation helpers shared by the forms.
//
// Every validator returns an object of `{ field: message }`; an empty object
// means the input is valid. Kept free of React/Next imports so the rules can
// be unit-tested with plain Node.

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_BIO_LENGTH = 300;

export const SECTOR_OPTIONS = [
  "Clean Energy",
  "EdTech",
  "FinTech",
  "HealthTech",
  "AgriTech",
  "SaaS",
  "D2C",
  "DeepTech",
  "Logistics",
  "Others",
];

export const GEOGRAPHY_OPTIONS = ["Bangalore", "Mumbai", "Delhi", "Hyderabad", "Chennai", "Other"];
export const EXPERIENCE_OPTIONS = ["1-3", "3-5", "5-10", "10+"];
export const CAPACITY_OPTIONS = ["1", "2", "3", "5+"];
export const AVAILABILITY_OPTIONS = ["Weekdays", "Weekends", "Flexible"];
/** `value` is what the backend stores; `label` is what the UI shows. */
export const STAGE_OPTIONS = [
  { value: "idea", label: "Idea" },
  { value: "MVP", label: "MVP" },
  { value: "growth", label: "Growth" },
  { value: "all", label: "All" },
];

// Deliberately pragmatic: one "@", no spaces, a dot in the domain part.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value) {
  return typeof value === "string" && EMAIL_RE.test(value.trim());
}

export function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Returns an error message for a rejected upload, or `null` when it's fine. */
export function validateUploadFile(file) {
  if (!file) return "Choose a PDF pitch deck first.";
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
  if (!isPdf) return "Only PDF files are supported.";
  if (file.size === 0) return "That file is empty. Pick a PDF with content in it.";
  if (file.size > MAX_UPLOAD_BYTES) return "File too large. Max size is 10MB.";
  return null;
}

export function validateRegistration({ role, name, email, password, sectorExpertise }) {
  const errors = {};
  if (!name || !name.trim()) errors.name = "Enter your name.";
  if (!email || !email.trim()) errors.email = "Enter your email address.";
  else if (!isValidEmail(email)) errors.email = "Enter a valid email address, like you@company.com.";
  if (!password) errors.password = "Choose a password.";
  else if (password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (role === "mentor" && (!Array.isArray(sectorExpertise) || sectorExpertise.length === 0)) {
    errors.sectorExpertise = "Pick at least one sector you can mentor in.";
  }
  return errors;
}

/** Per-step validation for the 4-step mentor onboarding flow (1-indexed). */
export function validateOnboardingStep(step, data) {
  const errors = {};
  if (step === 1) {
    if (!data.name || !data.name.trim()) errors.name = "Enter your full name.";
    if (data.linkedinUrl && data.linkedinUrl.trim() && !isHttpUrl(data.linkedinUrl.trim())) {
      errors.linkedinUrl = "Enter a full URL, like https://linkedin.com/in/you.";
    }
    if ((data.bio || "").length > MAX_BIO_LENGTH) {
      errors.bio = `Keep your bio under ${MAX_BIO_LENGTH} characters.`;
    }
    if (!GEOGRAPHY_OPTIONS.includes(data.geography)) errors.geography = "Pick your city.";
  }
  if (step === 2) {
    if (!Array.isArray(data.sectorExpertise) || data.sectorExpertise.length === 0) {
      errors.sectorExpertise = "Pick at least one sector.";
    }
    if (!EXPERIENCE_OPTIONS.includes(data.yearsExperience)) {
      errors.yearsExperience = "Pick your years of experience.";
    }
    if ((data.pastExits || "").length > MAX_BIO_LENGTH) {
      errors.pastExits = `Keep this under ${MAX_BIO_LENGTH} characters.`;
    }
  }
  if (step === 3) {
    if (!Array.isArray(data.preferredStages) || data.preferredStages.length === 0) {
      errors.preferredStages = "Pick at least one stage.";
    }
    if (!CAPACITY_OPTIONS.includes(data.maxStartupsPerMonth)) {
      errors.maxStartupsPerMonth = "Pick how many startups you can take on.";
    }
    if (!AVAILABILITY_OPTIONS.includes(data.availability)) {
      errors.availability = "Pick your availability.";
    }
  }
  return errors;
}

/**
 * "All" is exclusive in the stage ToggleGroup: picking it clears the specific
 * stages, and picking a specific stage clears "All".
 */
export function normalizeStages(next, previous = []) {
  const added = next.filter((s) => !previous.includes(s));
  if (added.includes("all")) return ["all"];
  if (next.includes("all") && next.length > 1) return next.filter((s) => s !== "all");
  return next;
}

/** Maps onboarding form state to the PATCH /mentor/profile body. */
export function toMentorProfilePayload(data) {
  return {
    name: data.name.trim(),
    linkedin_url: data.linkedinUrl?.trim() || null,
    bio: data.bio?.trim() || null,
    geography: data.geography,
    sector_expertise: data.sectorExpertise,
    years_experience: data.yearsExperience,
    past_exits: data.pastExits?.trim() || null,
    preferred_stages: data.preferredStages,
    max_startups_per_month: data.maxStartupsPerMonth,
    availability: data.availability,
  };
}

/**
 * Parses the Retrieval Metrics form. Returns `{ profile, ids, errors }`,
 * where `errors` follows the same `{ field: message }` convention.
 */
export function parseEvaluationInput(profileJson, idsText) {
  const errors = {};
  let profile = null;
  try {
    profile = JSON.parse(profileJson);
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      errors.profile = "The profile must be a JSON object.";
      profile = null;
    } else if (typeof profile.domain !== "string" || typeof profile.stage !== "string") {
      errors.profile = 'The profile needs at least "domain" and "stage" strings.';
    }
  } catch {
    errors.profile = "That isn't valid JSON.";
  }

  const ids = [
    ...new Set(
      String(idsText || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    ),
  ];
  if (ids.length === 0) errors.ids = "Enter at least one ground-truth mentor ID.";

  return { profile, ids, errors };
}
