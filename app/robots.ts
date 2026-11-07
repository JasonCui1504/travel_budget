import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      // Trip calendar feeds: Google Calendar's fetcher obeys robots.txt, so without this it can't
      // subscribe. Each feed still needs its secret token, so nothing becomes crawlable.
      allow: ["/api/trips/*/calendar.ics", "/api/travel/trips/*/calendar.ics"],
      disallow: ["/"],
    },
  };
}
