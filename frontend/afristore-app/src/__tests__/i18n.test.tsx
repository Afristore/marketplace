/**
 * Unit tests for the dependency-free i18n helper.
 */
import { renderHook } from "@testing-library/react";
import {
  defaultLocale,
  interpolate,
  supportedLocales,
  translate,
  type TranslationKey,
} from "@/lib/i18n/translate";
import { useTranslation } from "@/lib/i18n/useTranslation";

describe("i18n translate", () => {
  it("resolves nested keys from the default locale", () => {
    expect(translate("myCollections.badge")).toBe("My Collections");
    expect(translate("myCollections.card.viewDetails")).toBe("View Details");
  });

  it("returns the key instead of throwing when a lookup misses", () => {
    const spy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const missing = "myCollections.doesNotExist" as TranslationKey;

    expect(translate(missing)).toBe(missing);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("interpolates variables and leaves unknown placeholders intact", () => {
    expect(interpolate("Hello {{name}}", { name: "Amina" })).toBe(
      "Hello Amina",
    );
    expect(interpolate("Hi {{ name }}", { name: 3 })).toBe("Hi 3");
    expect(interpolate("Hi {{missing}}")).toBe("Hi {{missing}}");
    expect(interpolate("No variables")).toBe("No variables");
  });

  it("exposes the default locale as the only supported locale", () => {
    expect(defaultLocale).toBe("en");
    expect(supportedLocales).toEqual(["en"]);
  });
});

describe("useTranslation", () => {
  it("returns a stable translator bound to the default locale", () => {
    const { result } = renderHook(() => useTranslation());

    expect(result.current.locale).toBe("en");
    expect(result.current.locales).toEqual(["en"]);
    expect(result.current.t("myCollections.title")).toBe(
      "Your Created Collections",
    );
    expect(result.current.t("myCollections.stats.total")).toBe(
      "Total Collections",
    );
  });
});
