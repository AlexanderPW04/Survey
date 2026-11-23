// The approved questionnaire ("Dust Collection Questionnaire Approved.txt").
// It is loaded ONCE as the first draft when the dashboard finds no survey yet.
// After that, all changes are made in the dashboard's Survey tab — not here.
// Wording is copied exactly as approved (including "pace" in Q4 and "docs" in Q8).

const opt = (value, label, specifyLabel) =>
  specifyLabel ? { value, label, specify: true, specifyLabel } : { value, label };

export const SEED_SURVEY = {
  title: "Dust Collection Questionnaire",
  intro: "Thank you for collecting a dust sample! Please answer a few short questions about the sample. Do not enter your name, address, or anything else that could identify you.",
  thankYou: "Your answers have been recorded. Thank you for taking part — you can close this page.",
  questions: [
    {
      id: "q1", key: "collection_date", type: "date", required: true,
      label: "Date of dust collection (DD/MM/YYYY)",
      dateOrder: "DMY", noFuture: true,
    },
    {
      id: "q2", key: "spaces_vacuumed", type: "multiple", required: true,
      label: "The household space that was vacuumed for this dust collection (tick all that are applicable):",
      options: [
        opt("living_room", "Living room"),
        opt("dining_room", "Dining Room"),
        opt("kitchen", "Kitchen"),
        opt("patio", "Patio"),
        opt("hallway", "Hallway"),
        opt("other", "Other", "specify"),
      ],
    },
    {
      id: "q3", key: "vacuum_type", type: "single", required: true,
      label: "Type of vacuum used for dust collection:",
      options: [
        opt("handheld", "Handheld vacuum", "type/brand"),
        opt("robotic", "Robotic vacuum", "type/brand"),
      ],
    },
    {
      id: "q4", key: "previous_vacuum_date", type: "date", required: true,
      label: "When was this pace last vacuumed before current vacuuming (DD/MM/YYYY):",
      dateOrder: "DMY", noFuture: true, notAfter: "collection_date",
    },
    {
      id: "q5", key: "windows_closed", type: "single", required: true,
      label: "During the collection period (date of last previous vacuuming to current vacuuming date), were windows closed (i.e. air conditioning)?",
      options: [
        opt("yes", "Yes"),
        opt("no", "No"),
        opt("sometimes", "Sometimes closed but not always"),
        opt("other", "Other", "specify"),
      ],
    },
    {
      id: "q6", key: "occupants", type: "integer", required: true,
      label: "The number of occupants in the household:",
      min: 1, max: 50,
    },
    {
      id: "q7", key: "pets", type: "integer", required: true,
      label: "The number of pets in the household:",
      min: 0, max: 100,
    },
    {
      id: "q8", key: "pet_types", type: "multiple", required: true,
      label: "The type of pets in the household (e.g. docs, cats, turtles, birds, other):",
      options: [
        opt("dogs", "Dogs"),
        opt("cats", "Cats"),
        opt("turtles", "Turtles"),
        opt("birds", "Birds"),
        opt("other", "Other", "specify"),
      ],
      showIf: { key: "pets", op: "gt", number: 0 },
    },
    {
      id: "q9", key: "pets_outdoor_access", type: "yesno", required: true,
      label: "Do pets have access to garden or outdoor space?",
      showIf: { key: "pets", op: "gt", number: 0 },
    },
  ],
};
