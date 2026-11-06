import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// 44px minimum touch target. One tomato primary per screen; everything else is outline or ghost.
export const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-[background-color,transform,box-shadow] duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        primary: "bg-tomato text-on-tomato shadow-ticket hover:bg-tomato/90",
        outline: "border-[1.5px] border-input bg-ticket text-ink hover:bg-paper",
        ghost: "text-ink hover:bg-ink/6",
        danger: "border-[1.5px] border-bad text-bad hover:bg-bad-wash",
      },
      size: {
        md: "min-h-11 px-5 text-[0.95rem]",
        lg: "min-h-13 px-7 text-base",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
