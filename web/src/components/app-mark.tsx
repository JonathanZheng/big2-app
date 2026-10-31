/** The app icon: a black-edged orange tile with a 2 on paper. Used by the generated icons. */
export function Mark({ size }: { size: number }) {
  const border = Math.max(2, Math.round(size / 16));
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f2f0ea",
        border: `${border}px solid #111111`,
      }}
    >
      <div
        style={{
          width: "62%",
          height: "62%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ff5a1f",
          border: `${border}px solid #111111`,
          color: "#111111",
          fontSize: size * 0.48,
          fontWeight: 900,
          lineHeight: 1,
        }}
      >
        2
      </div>
    </div>
  );
}
