/** The four onboarding faces: dark hair, flat color face, simple features. Decorative. */
const FACES = [
  { fill: "#7B88FA", mouth: "smile" }, { fill: "#FFFFFF", mouth: "smile" },
  { fill: "#FFCC3E", mouth: "wink" }, { fill: "#ECECEC", mouth: "flat" },
] as const;

export function Faces({ size = 96 }: { size?: number }) {
  return (
    <div className="faces" aria-hidden>
      {FACES.map((face, index) => (
        <svg key={index} viewBox="0 0 100 100" width={size} height={size} style={{ marginLeft: index ? -size * 0.2 : 0 }}>
          <circle cx="50" cy="50" r="50" fill="#1E212B" />
          <circle cx="50" cy="62" r="34" fill={face.fill} />
          <g stroke="#1E212B" strokeWidth="5" strokeLinecap="round" fill="none">
            <path d="M39 55v5" />
            {face.mouth === "wink" ? <path d="M58 57h8" /> : <path d="M61 55v5" />}
            {face.mouth === "smile" && <path d="M40 72q10 9 20 0" />}
            {face.mouth === "wink" && <path d="M41 72q9 8 18 0" />}
            {face.mouth === "flat" && <path d="M42 74h16" />}
          </g>
        </svg>
      ))}
    </div>
  );
}
