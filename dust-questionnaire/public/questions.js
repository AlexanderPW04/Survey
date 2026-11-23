/**
 * ============================================================================
 *  QUESTIONNAIRE CONFIGURATION  —  the only file you normally need to edit
 * ============================================================================
 *
 *  After editing: bump `version`, then redeploy (`firebase deploy --only hosting`).
 *  Open admin.html afterwards — it flags any typos/mistakes in this file.
 *
 *  ADD a question ........ add a new object with a NEW, unique `id`.
 *  CHANGE wording ........ edit `label` / `help` / option labels. Keep the same
 *                          `id` only if the meaning is unchanged. If the meaning
 *                          changes, retire the old question and add a new one.
 *  REMOVE a question ..... DON'T delete it. Add `retired: true` (and optionally
 *                          `retiredIn: "1.1.0"`). It disappears from the form but
 *                          old answers still appear in the Excel export.
 *  REORDER ............... move objects up or down. (A `showIf` question must
 *                          come after the question it depends on.)
 *
 *  RULES FOR `id`: lowercase letters, numbers, single underscores, starts with a
 *  letter. Never rename or reuse an id — it is the Excel column name.
 *
 *  QUESTION FIELDS
 *    id          (required) e.g. "home_type"
 *    type        (required) "text" | "textarea" | "number" | "date" |
 *                           "radio" | "select" | "checkbox"
 *    label       (required) the question text shown to participants
 *    help        optional small text under the question
 *    required    true / false (default false)
 *    options     for radio/select/checkbox: [{ value: "dog", label: "Dog" }, ...]
 *                (a plain string "Dog" also works; value = label then).
 *                `value` is what gets stored — keep it short and stable.
 *    min, max, step   for number questions (step: 1 = whole numbers only)
 *    maxLength   for text/textarea (defaults 500 / 2000)
 *    allowFuture for date questions (default false = no future dates)
 *    showIf      only show when an earlier answer matches, e.g.
 *                { question: "has_pets", in: ["yes"] }
 *    addedIn / retiredIn / retired   bookkeeping for the data dictionary
 */

export const QUESTIONNAIRE = {
  version: "1.1.0",

  studyName: "Household Dust Virome Study",
  labName: "Your Lab Name · Your University",
  contactEmail: "lab@university.edu",
  irbNumber: "IRB # pending",
  intro:
    "Thank you for collecting a dust sample! Please answer a few short questions " +
    "about where the sample came from. Do not enter your name, address, or any " +
    "other information that could identify you.",

  // Anonymous sample IDs look like HD-7K3M9Q (letters/numbers that are hard to confuse).
  // If your kits already use another format, replace with e.g.
  //   sampleId: { pattern: "^DV[0-9]{5}$", example: "DV00123" }
  sampleId: { prefix: "HD-", length: 6 },

  // NOTE: the questions below are placeholders — replace them with the exact
  // wording approved by your ethics board.
  questions: [
    {
      id: "consent",
      type: "checkbox",
      label: "Consent",
      required: true,
      options: [
        { value: "yes", label: "I have read the study information sheet and agree to take part." },
      ],
      addedIn: "1.0.0",
    },
    {
      id: "collection_date",
      type: "date",
      label: "Date the dust sample was collected",
      required: true,
      addedIn: "1.0.0",
    },
    {
      id: "collection_room",
      type: "radio",
      label: "Which room was the sample collected from?",
      required: true,
      options: [
        { value: "living_room", label: "Living room" },
        { value: "bedroom", label: "Bedroom" },
        { value: "kitchen", label: "Kitchen" },
        { value: "other", label: "Other" },
      ],
      addedIn: "1.0.0",
    },
    {
      id: "collection_room_other",
      type: "text",
      label: "Please describe the room",
      showIf: { question: "collection_room", in: ["other"] },
      maxLength: 100,
      addedIn: "1.0.0",
    },
    {
      id: "surface_type",
      type: "select",
      label: "What surface was the dust collected from?",
      required: true,
      options: [
        { value: "carpet", label: "Wall-to-wall carpet" },
        { value: "rug", label: "Area rug" },
        { value: "hard_floor", label: "Hard floor (wood, tile, laminate)" },
        { value: "upholstery", label: "Furniture / upholstery" },
        { value: "other", label: "Other" },
      ],
      addedIn: "1.0.0",
    },
    {
      id: "home_type",
      type: "radio",
      label: "What type of home is it?",
      options: [
        { value: "house", label: "Detached house" },
        { value: "townhouse", label: "Townhouse / duplex" },
        { value: "apartment", label: "Apartment / condo" },
        { value: "mobile_home", label: "Mobile home" },
        { value: "other", label: "Other" },
      ],
      addedIn: "1.0.0",
    },
    {
      id: "home_size",
      type: "number",
      label: "About how many square feet is your home?",
      required: true,
      min: 450,
      max: 20000,
      step: 1,
      addedIn: "1.0.0",
    },
    {
      id: "children_under_5",
      type: "radio",
      label: "Do any children under 5 live in the home?",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
        { value: "prefer_not", label: "Prefer not to say" },
      ],
      addedIn: "1.0.0",
    },
    {
      id: "has_pets",
      type: "radio",
      label: "Are there pets in the home?",
      required: true,
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
      addedIn: "1.0.0",
    },
    {
      id: "pet_types",
      type: "checkbox",
      label: "Which pets? (select all that apply)",
      showIf: { question: "has_pets", in: ["yes"] },
      options: [
        { value: "dog", label: "Dog" },
        { value: "cat", label: "Cat" },
        { value: "bird", label: "Bird" },
        { value: "rodent", label: "Rodent (hamster, guinea pig, etc.)" },
        { value: "reptile", label: "Reptile / amphibian" },
        { value: "other", label: "Other" },
      ],
      addedIn: "1.0.0",
    },
    {
      id: "vacuum_frequency",
      type: "select",
      label: "How often is the sampled area vacuumed or swept?",
      options: [
        { value: "daily", label: "Daily" },
        { value: "few_per_week", label: "A few times a week" },
        { value: "weekly", label: "About once a week" },
        { value: "less_than_weekly", label: "Less than once a week" },
        { value: "rarely", label: "Rarely or never" },
      ],
      addedIn: "1.0.0",
    },
    {
      id: "recent_respiratory_illness",
      type: "radio",
      label: "In the past 2 weeks, has anyone in the home had cold, flu, or other respiratory symptoms?",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
        { value: "unsure", label: "Not sure" },
        { value: "prefer_not", label: "Prefer not to say" },
      ],
      addedIn: "1.0.0",
    },
    {
      id: "comments",
      type: "textarea",
      label: "Anything else about the sample we should know?",
      help: "Optional. Please don't include names or other identifying details.",
      maxLength: 1000,
      addedIn: "1.0.0",
    },
  ],
};
