// Pins the process time zone before any test worker starts, so wall-clock tests (WhenPicker, when.ts) behave the same
// on a laptop, in UTC CI and anywhere else. Setting TZ inside a test file is too late: module-level dates are already built.
export default function setup(): void {
  process.env.TZ = "America/New_York";
}
