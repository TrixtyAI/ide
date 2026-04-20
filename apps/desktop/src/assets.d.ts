// Static asset module declarations.
// `next-env.d.ts` references `next/image-types/global`, but CI runs
// `tsc --noEmit` before any `next` invocation has generated `.next/types`,
// which silently breaks that reference. Declaring the image module shapes
// here keeps typecheck green regardless of whether Next has run.

declare module "*.png" {
  const content: { src: string; height: number; width: number; blurDataURL?: string };
  export default content;
}

declare module "*.jpg" {
  const content: { src: string; height: number; width: number; blurDataURL?: string };
  export default content;
}

declare module "*.jpeg" {
  const content: { src: string; height: number; width: number; blurDataURL?: string };
  export default content;
}

declare module "*.svg" {
  const content: { src: string; height: number; width: number; blurDataURL?: string };
  export default content;
}

declare module "*.webp" {
  const content: { src: string; height: number; width: number; blurDataURL?: string };
  export default content;
}

declare module "*.gif" {
  const content: { src: string; height: number; width: number; blurDataURL?: string };
  export default content;
}
