import { z } from "zod";

export const brandingSchema = z.object({
  brandName: z.string().trim().min(1).max(60),
  logoUrl: z
    .string()
    .trim()
    .max(500)
    .refine((value) => {
      try {
        return new URL(value).protocol === "https:";
      } catch {
        return false;
      }
    }, "Use an https address")
    .nullish(),
  accentColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a color like #1a73e8")
    .nullish(),
  hideAttribution: z.boolean(),
});
export type BrandingInput = z.infer<typeof brandingSchema>;
