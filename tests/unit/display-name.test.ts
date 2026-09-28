import { expect, it } from "vitest";
import { displayName } from "../../src/server/display-name.ts";

it("prefers a nonblank Google name and otherwise uses the email local part", () => {
  expect(displayName(" Tao Xu ", "tao.xu@authright.com")).toBe("Tao Xu");
  for (const name of [undefined, null, "", " \t\n ", "　"])
    expect(displayName(name, "tao.xu@authright.com")).toBe("tao.xu");
  expect(displayName("徐涛", "tao.xu@authright.com")).toBe("徐涛");
  expect(displayName(null, "first.last+team@authright.com")).toBe(
    "first.last+team",
  );
});
