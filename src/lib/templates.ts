/**
 * The house's templates — instantiated for every new wedding from The
 * Desk, then freely completed per client. Nothing here is client-
 * specific: these are the blank moulds of the maison.
 */

export interface FormField {
  name: string;
  label: string;
  type?: "text" | "textarea";
}

export const DEFAULT_FORMS: { title: string; status: "awaiting" | "to_come"; due_label?: string; schema: FormField[]; sort: number }[] = [
  {
    title: "Your preferences & your story",
    status: "awaiting",
    sort: 1,
    schema: [
      { name: "story", label: "Your story — how you met, what this wedding should tell", type: "textarea" },
      { name: "tastes", label: "What you love (places, tables, music, flowers…)", type: "textarea" },
      { name: "avoid", label: "What the house should avoid", type: "textarea" }
    ]
  },
  {
    title: "Guest list & accommodation",
    status: "awaiting",
    sort: 2,
    schema: [
      { name: "count", label: "How many guests do you expect, roughly?" },
      { name: "vips", label: "The closest — who must be housed at the venue", type: "textarea" },
      { name: "notes", label: "Anything the house should know (mobility, families, children…)", type: "textarea" }
    ]
  },
  {
    title: "Menu choices & allergies",
    status: "to_come",
    due_label: "Closer to the tasting",
    sort: 3,
    schema: [
      { name: "allergies", label: "Allergies and dietary needs among your guests", type: "textarea" },
      { name: "wishes", label: "Dishes or wines that matter to you", type: "textarea" }
    ]
  }
];
