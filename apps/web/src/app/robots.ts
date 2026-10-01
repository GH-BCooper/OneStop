// robots.txt: the catalogue and landing page may be indexed; everything that belongs to a person,
// a running job or a one-off link may not.
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/account",
          "/history",
          "/settings",
          "/auth/",
          "/q/",
          "/s/",
          "/workflows",
          "/assistant",
        ],
      },
    ],
  };
}
