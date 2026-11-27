// Every test starts with an empty data cache (lib/queryCache.ts is module state that would otherwise carry one test's
// answers into the next test of the same file).
import { afterEach } from "vitest";
import { resetCache } from "../src/lib/queryCache";

afterEach(() => { resetCache(); });
