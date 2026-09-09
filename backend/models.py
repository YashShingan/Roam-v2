# ─── Roam core data models (Pydantic) ─────────────────────────────────────────
from __future__ import annotations

from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field

from services.price_engine import PriceHint, PriceSample


class Category(str, Enum):
    food = "food"
    culture = "culture"
    nature = "nature"
    market = "market"
    nightlife = "nightlife"
    adventure = "adventure"
    workshop = "workshop"
    hidden_gem = "hidden_gem"


CATEGORIES: list[Category] = list(Category)


class SourceRef(BaseModel):
    source: str
    url: Optional[str] = None
    note: Optional[str] = None


class CommunitySignal(BaseModel):
    mentions: int = 0
    upvotes: int = 0
    sentiment: float = 0.0  # -1..1 — 0 means "no signal"
    quotes: list[dict] = Field(default_factory=list)  # {text, permalink?}
    priceHint: Optional[int] = None
    crowdWarning: Optional[bool] = None
    hiddenGem: Optional[bool] = None


class Experience(BaseModel):
    id: str
    name: str
    category: Category
    source: str
    sources: list[SourceRef] = Field(default_factory=list)
    description: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    address: str = "Not listed"
    popularity: str = "New — no signal yet"
    popularityScore: float = 0.0
    community: CommunitySignal = Field(default_factory=CommunitySignal)
    pricePerPerson: Optional[int] = None
    priceIsEstimate: Optional[bool] = None
    durationMinutes: int = 60
    openingHoursRaw: Optional[str] = None
    isOutdoor: Optional[bool] = None
    wheelchairAccessible: Optional[bool] = None
    goodForKids: Optional[bool] = None
    bookingRequired: bool = False
    tags: list[str] = Field(default_factory=list)
    imageUrl: Optional[str] = None
    photoAttribution: Optional[str] = None
    amenities: list[str] = Field(default_factory=list)
    osmId: Optional[str] = None
    osmType: Optional[str] = None
    website: Optional[str] = None
    gmapsUrl: Optional[str] = None
    gmapsDirectionsUrl: Optional[str] = None
    bestTime: Optional[str] = None
    goldenHour: Optional[bool] = None
    distanceKm: Optional[float] = None
    walkTimeMin: Optional[str] = None
    driveTimeMin: Optional[str] = None
    priceHint: Optional[PriceHint] = None
    foundViaSearch: Optional[bool] = False


class ItineraryStop(BaseModel):
    experienceId: str
    name: str
    category: Category
    slotStart: str
    slotEnd: str
    travelMinFromPrev: int = 0
    legGeometry: Optional[list[list[float]]] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    durationMinutes: int = 60
    pricePerPerson: Optional[int] = None
    priceBasis: Optional[str] = None
    priceMin: Optional[float] = None
    priceMax: Optional[float] = None
    priceQuote: Optional[str] = None
    note: Optional[str] = None
    locked: Optional[bool] = None
    visited: Optional[bool] = None
    gmapsDirectionsUrl: Optional[str] = None


class TripDay(BaseModel):
    date: Optional[str] = None
    stops: list[ItineraryStop] = Field(default_factory=list)
    totalHours: float = 0
    walkKm: Optional[float] = None


class Feasibility(BaseModel):
    ok: bool = True
    message: str = ""


class TripPlan(BaseModel):
    id: str
    city: str
    cityLabel: str = ""
    lat: Optional[float] = None
    lon: Optional[float] = None
    createdAt: str = ""
    days: list[TripDay] = Field(default_factory=list)
    voiceSummary: str = ""
    feasibility: Feasibility = Field(default_factory=Feasibility)
    budgetTotal: Optional[int] = None
    budgetPerDay: Optional[int] = None
    budgetBand: Optional[dict[str, Any]] = None
    shareUrl: str = ""
    votes: Optional[dict[str, int]] = None
    goldenHourNotes: Optional[list[str]] = None


# ─── Voice assistant ──────────────────────────────────────────────────────────
class Vibe(str, Enum):
    chill = "chill"
    packed = "packed"
    foodie = "foodie"
    heritage = "heritage"


class AssistantResponse(BaseModel):
    actions: list[dict]
    reply: str
    nlu: str = "rules"
    sessionId: str = ""


# ─── Health / stats ───────────────────────────────────────────────────────────
class CollectorHealth(BaseModel):
    name: str
    ok: bool
    latencyMs: int
    count: int
    error: Optional[str] = None
    checkedAt: str = ""


class CityStats(BaseModel):
    city: str
    total: int = 0
    byCategory: dict[str, int] = Field(default_factory=dict)
    mentionsTotal: int = 0
    sentimentHistogram: list[dict] = Field(default_factory=list)
    topMentioned: list[dict] = Field(default_factory=list)
    sourceCounts: list[dict] = Field(default_factory=list)
    radar: list[dict] = Field(default_factory=list)
    avgPrice: Optional[float] = None


# ─── Raw hit (collector output before pipeline) ──────────────────────────────
class RawHit(BaseModel):
    name: str
    lat: Optional[float] = None
    lon: Optional[float] = None
    source: str = ""
    source_url: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    address: Optional[str] = None
    opening_hours: Optional[str] = None
    website: Optional[str] = None
    image_url: Optional[str] = None
    popularity: Optional[float] = None
    sitelinks: Optional[int] = None
    pageviews: Optional[int] = None
    osm_id: Optional[str] = None
    osm_type: Optional[str] = None
    wheelchair: Optional[bool] = None
    outdoor: Optional[bool] = None
    amenity_type: Optional[str] = None
    quotes: list[dict] = Field(default_factory=list)  # {text, permalink?}
    upvotes: int = 0
    mentions: int = 0


# ─── GeoContext (passed to all collectors) ────────────────────────────────────
class GeoCtx(BaseModel):
    city: str
    lat: float
    lon: float
    radiusKm: float = 15.0
    bbox: Optional[str] = None
