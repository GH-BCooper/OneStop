import type { HTMLAttributes } from "react";
import { cn } from "./cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
}

export function Card({ interactive, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "os-glow rounded-lg border border-border bg-surface bg-[image:var(--os-surface-sheen)] p-4 text-fg shadow-[var(--os-card-shadow)]",
        interactive && "transition-[transform,colors] duration-200 hover:-translate-y-0.5 hover:border-primary hover:bg-surface-muted",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A card's heading. `h3` by default, because most cards sit under a section heading; a card that is
 * a direct child of the page's `h1` says `as="h2"` so the outline never skips a level.
 */
export function CardTitle({
  as: Tag = "h3",
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement> & { as?: "h2" | "h3" | "h4" }) {
  return <Tag className={cn("text-base font-semibold", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-fg-muted", className)} {...props} />;
}
