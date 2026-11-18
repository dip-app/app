import { describe, expect, it } from "vitest";
import { UNKNOWN_TAG_NAME, opaqueTagId, tagName } from "../catalog";
import { buildMockDrafts } from "../ideasMock";
import { draftToPrefill } from "../ideas";
import { createTagResolver } from "../tagCatalog";

const live = [{ id: "EAI45AaOrCG7kx6v3nQk", name: "Fitness" }, { id: "q9ZxK2mT0wLpR7vB1cYd", name: " Food & Drink " }];

describe("createTagResolver", () => {
  it("maps opaque IDs to display names", () => {
    const resolver = createTagResolver(live);
    expect(resolver.name("EAI45AaOrCG7kx6v3nQk")).toBe("Fitness");
    expect(resolver.name("q9ZxK2mT0wLpR7vB1cYd")).toBe("Food & Drink");
    expect(resolver.has("EAI45AaOrCG7kx6v3nQk")).toBe(true);
  });

  it("falls back to 'Unknown tag' and never returns the raw ID", () => {
    const resolver = createTagResolver(live);
    expect(resolver.name("missing-id-123")).toBe(UNKNOWN_TAG_NAME);
    expect(resolver.has("missing-id-123")).toBe(false);
    expect(createTagResolver([{ id: "x", name: "  " }]).name("x")).toBe(UNKNOWN_TAG_NAME);
    expect(createTagResolver([]).name("EAI45AaOrCG7kx6v3nQk")).toBe("Unknown tag");
    expect(tagName("EAI45AaOrCG7kx6v3nQk")).toBe("Unknown tag");
  });
});

describe("Dipbot draft hand-off with opaque IDs", () => {
  const draft = { ...buildMockDrafts({ focusTagIds: ["tag-fitness"], goal: "team_bonding", groupSize: "medium", setting: "either", budget: "low", timing: "weekday_lunch" } as never, "", 1)[0] };

  it("keeps the draft's tags that exist in the live catalog, by ID", () => {
    const ids = [opaqueTagId("tag-fitness"), opaqueTagId("tag-outdoors"), "not-in-catalog"];
    const fill = draftToPrefill({ ...draft, tagIds: ids }, [opaqueTagId("tag-fitness"), opaqueTagId("tag-outdoors"), opaqueTagId("tag-social")]);
    expect(fill.tagIds).toEqual([opaqueTagId("tag-fitness"), opaqueTagId("tag-outdoors")]);
  });

  it("makes IDs look like production's: 20 alphanumerics, stable", () => {
    expect(opaqueTagId("tag-fitness")).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(opaqueTagId("tag-fitness")).toBe(opaqueTagId("tag-fitness"));
    expect(opaqueTagId("tag-fitness")).not.toBe(opaqueTagId("tag-games"));
  });
});
