/**
 * The four onboarding faces, redrawn from the app's welcome card. Each is a large dark "hair" disc with a
 * smaller face disc sitting low and slightly left inside it; later discs overlap earlier ones, so each
 * neighbour's hair cuts into the previous face's right edge. Decorative.
 */
const HAIR_R = 114;
const FACE_R = 82;
const FACES = [
  { hairX: 146, faceX: 151, fill: "#7B88FA", look: "smile" },
  { hairX: 340, faceX: 343, fill: "#FFFFFF", look: "smile" },
  { hairX: 540, faceX: 536, fill: "#FFCC3E", look: "wink" },
  { hairX: 735, faceX: 728, fill: "#ECECEC", look: "flat" },
] as const;
const HAIR_Y = 232;
const FACE_Y = 260;
const INK = "#1E212B";

export function Faces({ width = 520 }: { width?: number }) {
  return (
    <svg viewBox="30 108 822 248" width={width} role="presentation" aria-hidden style={{ maxWidth: "100%", height: "auto" }}>
      {FACES.map((face) => (
        <g key={face.hairX}>
          <circle cx={face.hairX} cy={HAIR_Y} r={HAIR_R} fill={INK} />
          <circle cx={face.faceX} cy={FACE_Y} r={FACE_R} fill={face.fill} />
          <g stroke={INK} strokeWidth="9" strokeLinecap="round" fill="none">
            <path d={`M${face.faceX - 27} ${FACE_Y - 17}v14`} />
            {face.look === "wink" ? (
              <path d={`M${face.faceX + 17} ${FACE_Y - 12}h20`} />
            ) : (
              <path d={`M${face.faceX + 27} ${FACE_Y - 17}v14`} />
            )}
            {face.look === "flat" ? (
              <path d={`M${face.faceX - 24} ${FACE_Y + 29}h48`} />
            ) : (
              <path d={`M${face.faceX - 28} ${FACE_Y + 24}q28 20 56 0`} />
            )}
          </g>
        </g>
      ))}
    </svg>
  );
}
