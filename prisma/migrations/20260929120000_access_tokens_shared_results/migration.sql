-- 21-roadmap-expansion.md (roadmap §2): personal access tokens and shareable read-only result links.

CREATE TABLE "access_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "access_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "access_tokens_tokenHash_key" ON "access_tokens"("tokenHash");
CREATE INDEX "access_tokens_userId_createdAt_idx" ON "access_tokens"("userId", "createdAt");

ALTER TABLE "access_tokens" ADD CONSTRAINT "access_tokens_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "shared_results" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "title" TEXT,
    "secretHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),

    CONSTRAINT "shared_results_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shared_results_slug_key" ON "shared_results"("slug");
CREATE INDEX "shared_results_userId_createdAt_idx" ON "shared_results"("userId", "createdAt");
CREATE INDEX "shared_results_expiresAt_idx" ON "shared_results"("expiresAt");

ALTER TABLE "shared_results" ADD CONSTRAINT "shared_results_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
