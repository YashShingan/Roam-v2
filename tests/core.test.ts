// ─── Core data-pipeline unit tests (pure functions, no network) ──────────────
import { describe, expect, it } from "vitest";
import { dedupKey, isBareGeoFragment, meaningfulOverlap, parseBbox, stripPossessive, tokenSim } from "@/lib/net";
import { isVisitablePlace, normalizePlaceName, openNowFromHours } from "@/lib/pipeline";

describe("dedupKey", () => {
  it("ignores case, accents, punctuation and word order", () => {
    expect(dedupKey("Café Aroma!")).toBe(dedupKey("aroma cafe"));
    expect(dedupKey("The Gateway of India")).toBe(dedupKey("gateway india of the"));
  });
  it("collapses whitespace", () => {
    expect(dedupKey("Shiv   Mandir")).toBe(dedupKey("shiv mandir"));
  });
});

describe("tokenSim", () => {
  it("scores identical keys 100", () => {
    expect(tokenSim("Durgadi Fort", "fort durgadi")).toBe(100);
  });
  it("scores partial overlap proportionally", () => {
    const sim = tokenSim("Durgadi Sea Fort", "Durgadi Fort");
    expect(sim).toBeGreaterThan(60);
    expect(sim).toBeLessThan(100);
  });
  it("scores unrelated names 0", () => {
    expect(tokenSim("Marine Drive", "Aroma Cafe")).toBe(0);
  });
});

describe("normalizePlaceName", () => {
  it("strips trailing separators leaked from mined titles", () => {
    expect(normalizePlaceName("Durgadi Fort -")).toBe("Durgadi Fort");
    expect(normalizePlaceName("Gateway of India |")).toBe("Gateway of India");
    expect(normalizePlaceName("Mumbai –")).toBe("Mumbai");
  });
  it("strips leading separators and collapses whitespace", () => {
    expect(normalizePlaceName("  —  Marine Drive")).toBe("Marine Drive");
    expect(normalizePlaceName("Kala   Talao")).toBe("Kala Talao");
  });
  it("never rewrites real content", () => {
    expect(normalizePlaceName("Cafe Mondegar")).toBe("Cafe Mondegar");
  });
});

describe("isVisitablePlace", () => {
  const city = "Kalyan";
  it("keeps real places", () => {
    for (const name of ["Durgadi Fort", "Shivaji Park", "Aroma Cafe", "Kalyan Mandai", "Titwala Ganesh Temple"])
      expect(isVisitablePlace(name, city)).toBe(true);
  });
  it("drops schools, banks, hospitals, housing and admin", () => {
    for (const name of ["Kalyan High School", "SBI Bank Kalyan", "Sunrise Hospital", "Shivneri Apartments", "Municipal Corporation Office"])
      expect(isVisitablePlace(name, city)).toBe(false);
  });
  it("drops bare city names and transit stops", () => {
    expect(isVisitablePlace("Kalyan", city)).toBe(false);
    expect(isVisitablePlace("Kalyan Junction", city)).toBe(false);
    expect(isVisitablePlace("Shivaji Nagar Bus Depot", city)).toBe(false);
  });
});

describe("meaningfulOverlap", () => {
  it("matches on distinctive tokens only", () => {
    expect(meaningfulOverlap("Siddhivinayak Mahaganapati Temple", "Siddhivinayak Mahaganapati Temple Titwala", "Kalyan-Dombivli")).toBeGreaterThan(0);
  });
  it("ignores generic venue words", () => {
    expect(meaningfulOverlap("Shiv Sagar Veg. Restaurant", "Another Family Restaurant", "Mumbai")).toBe(0);
  });
  it("ignores the city's own name even in the place name", () => {
    expect(meaningfulOverlap("Thane Vegetable Market", "Thane", "Thane")).toBe(0);
  });
  it("still matches places named after their neighborhood", () => {
    expect(meaningfulOverlap("Jogger's Park", "Joggers park", "Mumbai")).toBeGreaterThan(0);
  });
});

describe("openNowFromHours", () => {
  it("reads 24/7", () => {
    expect(openNowFromHours("24/7")).toBe(true);
  });
  it("parses day-scoped ranges", () => {
    const hours = "Mo-Sa 09:00-21:00";
    const wed10 = new Date(2026, 8, 9, 10, 0); // Wed
    expect(openNowFromHours(hours, wed10)).toBe(true);
    const wed22 = new Date(2026, 8, 9, 22, 0);
    expect(openNowFromHours(hours, wed22)).toBe(false);
  });
  it("returns null for unparsable input", () => {
    expect(openNowFromHours(undefined)).toBeNull();
    expect(openNowFromHours("call us")).toBeNull();
  });
});

describe("parseBbox", () => {
  it("parses valid bboxes", () => {
    expect(parseBbox("72.8,19.0,73.0,19.3")).toEqual({ w: 72.8, s: 19, e: 73, n: 19.3 });
  });
  it("rejects malformed ones", () => {
    expect(parseBbox("1,2,3")).toBeNull();
    expect(parseBbox("a,b,c,d")).toBeNull();
    expect(parseBbox("73,19,72,18")).toBeNull();
  });
});

describe("isBareGeoFragment / stripPossessive (mined-junk gate)", () => {
  it("kills mined geography fragments from the user report", () => {
    for (const name of ["India's", "Mumbai's", "West Asia", "South Asia", "Asia", "Kolkata", "South India", "India"])
      expect(isBareGeoFragment(name)).toBe(true);
  });
  it("never kills real places", () => {
    for (const name of ["Gateway of India", "India United Mills", "Nando's", "Ram Ashray South Indian", "VINTAGE INDIA", "Kala Ghoda Cafe"])
      expect(isBareGeoFragment(name)).toBe(false);
  });
  it("strips possessives without touching venues", () => {
    expect(stripPossessive("India's")).toBe("India");
    expect(stripPossessive("Nando's")).toBe("Nando");
  });
});
