"use client";
// The last-resort boundary, used only when the root layout itself fails, so it cannot lean on the
// theme, the header or any shared component: plain markup and its own tiny stylesheet.
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#d3dde6",
          color: "#101418",
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>OneStop hit a problem</h1>
          <p style={{ margin: "0 0 16px", lineHeight: 1.5 }}>
            Nothing you uploaded was lost. Reload the page to try again.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: 0,
              background: "#101418",
              color: "#fff",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
