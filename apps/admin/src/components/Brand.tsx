import { useId } from "react";

/** The DIP cloud mark (Figma favicon): purple disc, white cloud clipped to it, three flat strokes. */
export function CloudMark({ size = 40 }: { size?: number }) {
  const mask = useId();
  return (
    <svg viewBox="0 0 255 255" width={size} height={size} aria-hidden>
      <circle cx="127.5" cy="127.5" r="127.5" fill="#7C88FA" />
      <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="255" height="255">
        <circle cx="127.5" cy="127.5" r="127.5" fill="#fff" />
      </mask>
      <g mask={`url(#${mask})`}>
        <path
          fill="#fff"
          d="M167.921 291.231C200.868 291.231 227.576 264.522 227.576 231.575V217.089H241.116C274.063 217.089 300.772 190.38 300.772 157.433C300.772 124.486 274.063 97.777 241.116 97.7769H227.576V85.8931C227.576 52.9461 200.868 26.237 167.921 26.2368C134.974 26.2368 108.265 52.946 108.265 85.8931V97.7769H95.4346C62.4875 97.7769 35.7784 124.486 35.7783 157.433C35.7783 190.38 62.4874 217.089 95.4346 217.089H108.265V231.575C108.265 264.522 134.974 291.231 167.921 291.231Z"
        />
        <g fill="none" stroke="#7C88FA" strokeWidth="14.8" strokeLinecap="round">
          <path d="M121.743 136.694C124.663 130.056 134.549 119.577 150.731 130.762" />
          <path d="M174.12 129.061C177.04 122.423 186.926 111.944 203.108 123.129" />
          <path d="M200.107 144.821C193.277 160.346 170.155 184.856 132.308 158.695" />
        </g>
      </g>
    </svg>
  );
}
