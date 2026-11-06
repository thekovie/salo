import { cn as classNames } from "cn";

export function cn(...inputs: Parameters<typeof classNames>): string {
  return classNames(...inputs);
}
