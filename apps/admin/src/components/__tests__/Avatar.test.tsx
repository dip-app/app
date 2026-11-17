// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Avatar, mascotFor, photoSrc } from "../Avatar";

afterEach(cleanup);
const GOOGLE = "https://lh3.googleusercontent.com/a/ACg8ocJabc";

describe("photoSrc", () => {
  it("adds the size suffix to Google base URLs and keeps an existing one", () => {
    expect(photoSrc(GOOGLE, 96)).toBe(`${GOOGLE}=s96-c`);
    expect(photoSrc(GOOGLE, 192)).toBe(`${GOOGLE}=s192-c`);
    expect(photoSrc(`${GOOGLE}=s64-c`)).toBe(`${GOOGLE}=s64-c`);
  });
  it("only renders Google https photos and same-origin assets", () => {
    expect(photoSrc("")).toBeNull();
    expect(photoSrc(undefined)).toBeNull();
    expect(photoSrc("http://lh3.googleusercontent.com/a/x")).toBeNull();
    expect(photoSrc("https://example.com/x.png")).toBeNull();
    expect(photoSrc("javascript:alert(1)")).toBeNull();
    expect(photoSrc("/img/mock-photos/p1.svg")).toBe("/admin/img/mock-photos/p1.svg");
  });
});

describe("mascotFor", () => {
  it("maps colour names and numbered ids, and ignores unknown ones", () => {
    expect(mascotFor("teal")).toBe("teal");
    expect(mascotFor("avatar-01")).toBe("pink");
    expect(mascotFor("avatar-8")).toBe("blue");
    expect(mascotFor("avatar-9")).toBe("pink");
    expect(mascotFor("")).toBeNull();
    expect(mascotFor("custom")).toBeNull();
  });
});

describe("Avatar fallback chain", () => {
  it("shows the Google photo, decorative and without a referrer, at the requested size", () => {
    const { container } = render(<Avatar name="Pat Lee" photoURL={GOOGLE} avatarId="avatar-2" />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(`${GOOGLE}=s96-c`);
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("width")).toBe("32");
    expect(img.getAttribute("height")).toBe("32");
  });
  it("asks for a larger photo at 64px", () => {
    const { container } = render(<Avatar name="Pat Lee" photoURL={GOOGLE} size={64} />);
    expect(container.querySelector("img")!.getAttribute("src")).toBe(`${GOOGLE}=s192-c`);
    expect(container.querySelector("img")!.getAttribute("width")).toBe("64");
  });
  it("falls back to the mascot when the photo fails to load, then to initials", () => {
    const { container } = render(<Avatar name="Pat Lee" photoURL={GOOGLE} avatarId="avatar-2" />);
    fireEvent.error(container.querySelector("img")!);
    const mascot = container.querySelector("img")!;
    expect(mascot.getAttribute("src")).toBe("/admin/img/avatars/red.webp");
    expect(mascot.getAttribute("alt")).toBe("");
    fireEvent.error(mascot);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("PL");
  });
  it("uses the mascot without a photo and initials without either", () => {
    const withMascot = render(<Avatar name="Pat Lee" avatarId="avatar-3" />);
    expect(withMascot.container.querySelector("img")!.getAttribute("src")).toBe("/admin/img/avatars/purple.webp");
    cleanup();
    const bare = render(<Avatar name="Sam Roe" />);
    expect(bare.container.querySelector("img")).toBeNull();
    expect(bare.container.textContent).toBe("SR");
    expect(bare.container.querySelector(".avatar")!.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("Avatar chain: photo, stored avatar, generated avatar, initials", () => {
  it("real accounts (no photo, no avatar id) get the generated character for their user id, not initials", () => {
    const { container } = render(<Avatar name="Pat Lee" userId="uid-123" photoURL="" avatarId="" />);
    expect(container.querySelector("img")).toBeNull();
    const crew = container.querySelector("svg.avatar.crew")!;
    expect(crew.getAttribute("data-avatar")).toBe("crew-square-wink-white");
    expect(crew.getAttribute("aria-hidden")).toBe("true");
    expect(container.textContent).toBe("");
  });
  it("a photo that fails to load falls to the stored avatar, then to the generated one, never straight to initials", () => {
    const { container } = render(<Avatar name="Pat Lee" userId="uid-123" photoURL={GOOGLE} avatarId="avatar-2" />);
    fireEvent.error(container.querySelector("img")!);
    const mascot = container.querySelector("img")!;
    expect(mascot.getAttribute("src")).toBe("/admin/img/avatars/red.webp");
    fireEvent.error(mascot);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg.crew")!.getAttribute("data-avatar")).toBe("crew-square-wink-white");
  });
  it("a failed photo with no stored avatar falls to the generated avatar", () => {
    const { container } = render(<Avatar name="Pat Lee" userId="member-1" photoURL={GOOGLE} />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("svg.crew")!.getAttribute("data-avatar")).toBe("crew-round-calm-yellow");
  });
  it("initials only appear when the user id is unknown too", () => {
    const { container } = render(<Avatar name="Pat Lee" />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.textContent).toBe("PL");
  });
  it("sizes the generated avatar like the other stages", () => {
    const { container } = render(<Avatar name="Pat Lee" userId="u" size={64} />);
    const crew = container.querySelector("svg.crew")!;
    expect(crew.getAttribute("width")).toBe("64");
    expect(crew.getAttribute("data-avatar")).toBe("crew-square-wink-grey");
  });
});
