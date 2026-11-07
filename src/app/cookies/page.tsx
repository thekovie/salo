import type { Metadata } from "next";
import Link from "next/link";
import { AnalyticsSwitch } from "@/components/analytics/analytics-switch";
import { PolicyPage, PolicySection } from "@/components/policy/policy-page";

export const metadata: Metadata = {
  title: "Cookie policy",
  description: "The cookies and browser storage Salo uses, what each is for, and how to turn analytics off.",
  alternates: { canonical: "/cookies" },
};

const ROWS = [
  ["salo_s_<order>", "Essential cookie", "Keeps your browser in an order, so you can come back to it. Only Salo's server can read it.", "31 days, or until the order is deleted"],
  ["ph_phc_…_posthog", "Analytics cookie (PostHog)", "An anonymous ID so PostHog can tell one visit from another.", "About 1 year"],
  ["PostHog storage (localStorage, sessionStorage)", "Analytics", "Queues events and keeps session-replay state for the current visit.", "The visit, or about 1 year"],
  ["Cloudflare Turnstile", "Security (on challenges.cloudflare.com)", "Tells people from bots when you start an order; may keep short-lived data in its own frame.", "Minutes"],
  ["theme", "Preference (localStorage)", "Your light or dark choice.", "Until you clear it"],
  ["salo:tour:host / salo:tour:guest", "Preference (localStorage)", "Remembers that you've seen the first-time tour offer.", "Until you clear it"],
  ["salo:removed-reload:…", "Essential (sessionStorage)", "Stops the page reloading in a loop if the host removed you from an order.", "Until you close the tab"],
] as const;

export default function CookiesPage() {
  return (
    <PolicyPage
      title="Cookie policy"
      intro="Salo keeps a few small things in your browser: one cookie that keeps you in your order, a couple of preferences, and anonymous analytics you can switch off below."
    >
      <PolicySection id="list" title="What we store">
        {/* Scrolls sideways on narrow phones; focusable so keyboard users can scroll it too. */}
        <div role="region" aria-label="Cookies and storage" tabIndex={0} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b-[1.5px] border-rule text-ink">
                <th scope="col" className="py-2 pr-3 font-semibold">Name</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Type</th>
                <th scope="col" className="py-2 pr-3 font-semibold">What it&rsquo;s for</th>
                <th scope="col" className="py-2 font-semibold">How long</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([name, type, purpose, duration]) => (
                <tr key={name} className="border-b-[1.5px] border-dashed border-rule align-top">
                  <td className="py-2.5 pr-3 font-mono text-xs break-all text-ink">{name}</td>
                  <td className="py-2.5 pr-3">{type}</td>
                  <td className="py-2.5 pr-3">{purpose}</td>
                  <td className="py-2.5">{duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>Salo uses no advertising or social-media cookies.</p>
      </PolicySection>

      <PolicySection id="analytics-choice" title="Turning analytics off">
        <p>
          Analytics is on by default and helps us find what&rsquo;s confusing. Replays hide everything you type and people&rsquo;s names, dishes and order names (see the{" "}
          <Link href="/privacy#analytics">privacy policy</Link>). You can switch it off for this browser at any time:
        </p>
        <AnalyticsSwitch />
        <p>If your browser sends Do Not Track, analytics stays off automatically. Clearing your browser&rsquo;s site data also removes everything listed above, including the order cookie.</p>
      </PolicySection>

      <PolicySection id="essential" title="Essential cookies">
        <p>The order cookie is needed for Salo to work: without it your browser can&rsquo;t stay in an order. It is set only when you start or join one, and isn&rsquo;t used for tracking.</p>
      </PolicySection>
    </PolicyPage>
  );
}
