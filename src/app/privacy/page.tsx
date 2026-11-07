import type { Metadata } from "next";
import Link from "next/link";
import { POLICY_CONTACT, PolicyPage, PolicySection } from "@/components/policy/policy-page";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What Salo collects when you order with your table, why, how long it is kept, and how to reach us.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <PolicyPage
      title="Privacy policy"
      intro="Salo helps a table collect its restaurant order. It has no accounts, no ads and no payments. This page explains, in plain words, what Salo keeps, why, and for how long."
    >
      <PolicySection id="who" title="Who we are">
        <p>
          Salo (salo.thekovie.com) is an independent project. For anything about your data, write to <a href={`mailto:${POLICY_CONTACT}`}>{POLICY_CONTACT}</a>.
        </p>
      </PolicySection>

      <PolicySection id="what" title="What we collect">
        <ul>
          <li>
            <strong>What you type into an order:</strong> display names, dishes, sizes and notes, group names, the order&rsquo;s name, and a reason if the host removes someone.
            Everyone in that order can see it; nobody else can.
          </li>
          <li>
            <strong>An order cookie:</strong> a random key that keeps your browser in an order. We store only a scrambled (hashed) copy of it. See the{" "}
            <Link href="/cookies">cookie policy</Link>.
          </li>
          <li>
            <strong>Your IP address, briefly:</strong> used in the server&rsquo;s memory to limit abuse (for example, too many wrong join codes). It is not saved with
            your order. Server and proxy logs may record IP address, time and page requested for security and troubleshooting, and are kept for a short time.
          </li>
          <li>
            <strong>A bot check when you start an order:</strong> Cloudflare Turnstile looks at your IP address and browser signals to tell
            people from bots. It runs only on the &ldquo;start an order&rdquo; step, and Salo keeps nothing from it.
          </li>
          <li>
            <strong>Usage analytics:</strong> see below.
          </li>
        </ul>
        <p>We don&rsquo;t ask for your email, phone number, real name, location or payment details.</p>
      </PolicySection>

      <PolicySection id="analytics" title="Analytics and session replays">
        <p>
          To find confusing parts of the app, Salo uses <strong>PostHog</strong> (servers in the United States). It records anonymous usage: pages visited, taps
          and clicks (without the words on the buttons), errors, the kind of device and browser, an approximate location derived from the IP address, and{" "}
          <strong>session replays</strong>, a recreation of how the screen changed while you used it.
        </p>
        <p>
          Replays <strong>hide everything you type</strong>, plus <strong>people&rsquo;s names, dishes and order names</strong>, so we can see where people get stuck
          without seeing who ordered what. Analytics data isn&rsquo;t linked to your name and is never sold or used for ads.
        </p>
        <p>
          You can turn analytics off for your browser on the <Link href="/cookies#analytics-choice">cookie policy</Link> page. If your browser sends Do Not Track, Salo
          sends nothing.
        </p>
      </PolicySection>

      <PolicySection id="why" title="Why we use it">
        <ul>
          <li>Order data and the order cookie: to run the order you asked for (adding dishes, sharing with your table, the waiter ticket, &ldquo;who ordered what&rdquo;).</li>
          <li>IP addresses and logs: to keep the service secure and working.</li>
          <li>Analytics: our legitimate interest in understanding what is hard to use and fixing it.</li>
        </ul>
      </PolicySection>

      <PolicySection id="retention" title="How long we keep it">
        <ul>
          <li>An order and everything in it is deleted 7 days after it ends, or after 30 days with no activity. A cancelled order is deleted after 1 day.</li>
          <li>The order cookie expires after 31 days, and stops working once its order is deleted.</li>
          <li>Abuse-limit counters live only in the server&rsquo;s memory and reset within the hour, or on restart.</li>
          <li>Analytics and replays are kept according to our PostHog retention settings, and only as long as they help improve Salo.</li>
        </ul>
      </PolicySection>

      <PolicySection id="sharing" title="Who else handles it">
        <ul>
          <li>Our own server (a virtual private server we run), which hosts the app and its database.</li>
          <li>PostHog, Inc., which processes analytics and replays for us in the United States.</li>
          <li>Cloudflare, Inc., which runs the bot check when you start an order.</li>
        </ul>
        <p>We don&rsquo;t sell or rent personal data, and we don&rsquo;t share it with advertisers.</p>
      </PolicySection>

      <PolicySection id="rights" title="Your rights">
        <p>
          Under the Philippine Data Privacy Act of 2012, you can ask to see, correct or delete personal data about you, object to its processing, or ask for a copy.
          Email <a href={`mailto:${POLICY_CONTACT}`}>{POLICY_CONTACT}</a> and tell us which order (its name and date) it is about. Because Salo has no accounts, we may
          ask you to show it&rsquo;s your order, for example from the phone you used. You can also complain to the National Privacy Commission (privacy.gov.ph).
        </p>
      </PolicySection>

      <PolicySection id="children" title="Children">
        <p>Salo is meant for groups ordering together and isn&rsquo;t designed for children to use on their own.</p>
      </PolicySection>

      <PolicySection id="changes" title="Changes">
        <p>If this policy changes, we&rsquo;ll update this page and the date at the top.</p>
      </PolicySection>
    </PolicyPage>
  );
}
