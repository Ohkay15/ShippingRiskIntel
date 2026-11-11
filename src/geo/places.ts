/**
 * Built-in gazetteer: the freight hubs, ports and border crossings most
 * shipments start or end at. Looking these up locally means the common
 * case never calls an outside geocoder (fast, free, works offline, and
 * keeps us well inside the public geocoder's fair-use limits).
 *
 * Coordinates are city centres, which is all a lane map needs.
 */

export interface Place {
  /** Canonical display name, e.g. "Chicago, IL". */
  name: string;
  lat: number;
  lon: number;
  /** Two-letter US state / Canadian province / country code. */
  region: string;
  country: string;
}

type Row = [name: string, region: string, lat: number, lon: number, country?: string];

const ROWS: Row[] = [
  // US freight hubs
  ["Atlanta", "GA", 33.749, -84.388],
  ["Savannah", "GA", 32.081, -81.091],
  ["Chicago", "IL", 41.878, -87.63],
  ["Joliet", "IL", 41.525, -88.082],
  ["Columbus", "OH", 39.961, -82.999],
  ["Cleveland", "OH", 41.499, -81.694],
  ["Cincinnati", "OH", 39.103, -84.512],
  ["Toledo", "OH", 41.654, -83.537],
  ["Dallas", "TX", 32.777, -96.797],
  ["Fort Worth", "TX", 32.755, -97.331],
  ["Houston", "TX", 29.76, -95.37],
  ["San Antonio", "TX", 29.424, -98.494],
  ["Austin", "TX", 30.267, -97.743],
  ["El Paso", "TX", 31.762, -106.485],
  ["Laredo", "TX", 27.506, -99.507],
  ["Los Angeles", "CA", 34.052, -118.244],
  ["Long Beach", "CA", 33.77, -118.194],
  ["Oakland", "CA", 37.804, -122.271],
  ["San Francisco", "CA", 37.775, -122.419],
  ["San Diego", "CA", 32.716, -117.161],
  ["Sacramento", "CA", 38.582, -121.494],
  ["Fresno", "CA", 36.738, -119.787],
  ["Ontario", "CA", 34.063, -117.651],
  ["Stockton", "CA", 37.958, -121.291],
  ["Seattle", "WA", 47.606, -122.332],
  ["Tacoma", "WA", 47.253, -122.444],
  ["Spokane", "WA", 47.659, -117.426],
  ["Portland", "OR", 45.505, -122.675],
  ["Boise", "ID", 43.615, -116.202],
  ["Salt Lake City", "UT", 40.761, -111.891],
  ["Las Vegas", "NV", 36.17, -115.14],
  ["Reno", "NV", 39.53, -119.814],
  ["Phoenix", "AZ", 33.448, -112.074],
  ["Tucson", "AZ", 32.222, -110.975],
  ["Albuquerque", "NM", 35.084, -106.651],
  ["Denver", "CO", 39.739, -104.99],
  ["Kansas City", "MO", 39.1, -94.579],
  ["St. Louis", "MO", 38.627, -90.199],
  ["Omaha", "NE", 41.257, -95.934],
  ["Des Moines", "IA", 41.587, -93.625],
  ["Minneapolis", "MN", 44.978, -93.265],
  ["Milwaukee", "WI", 43.039, -87.906],
  ["Madison", "WI", 43.073, -89.401],
  ["Green Bay", "WI", 44.513, -88.013],
  ["Detroit", "MI", 42.331, -83.046],
  ["Grand Rapids", "MI", 42.963, -85.668],
  ["Indianapolis", "IN", 39.768, -86.158],
  ["Fort Wayne", "IN", 41.079, -85.139],
  ["Louisville", "KY", 38.253, -85.759],
  ["Lexington", "KY", 38.04, -84.503],
  ["Nashville", "TN", 36.163, -86.781],
  ["Memphis", "TN", 35.149, -90.049],
  ["Knoxville", "TN", 35.961, -83.921],
  ["Chattanooga", "TN", 35.046, -85.309],
  ["Birmingham", "AL", 33.519, -86.81],
  ["Mobile", "AL", 30.695, -88.04],
  ["Jackson", "MS", 32.299, -90.185],
  ["New Orleans", "LA", 29.951, -90.072],
  ["Baton Rouge", "LA", 30.451, -91.187],
  ["Little Rock", "AR", 34.746, -92.29],
  ["Oklahoma City", "OK", 35.468, -97.516],
  ["Tulsa", "OK", 36.154, -95.993],
  ["Wichita", "KS", 37.687, -97.33],
  ["Miami", "FL", 25.762, -80.192],
  ["Jacksonville", "FL", 30.332, -81.656],
  ["Orlando", "FL", 28.538, -81.379],
  ["Tampa", "FL", 27.951, -82.457],
  ["Charlotte", "NC", 35.227, -80.843],
  ["Raleigh", "NC", 35.78, -78.639],
  ["Greensboro", "NC", 36.073, -79.792],
  ["Charleston", "SC", 32.777, -79.931],
  ["Greenville", "SC", 34.853, -82.394],
  ["Columbia", "SC", 34.0, -81.035],
  ["Richmond", "VA", 37.541, -77.436],
  ["Norfolk", "VA", 36.851, -76.286],
  ["Baltimore", "MD", 39.29, -76.612],
  ["Washington", "DC", 38.907, -77.037],
  ["Philadelphia", "PA", 39.953, -75.165],
  ["Pittsburgh", "PA", 40.441, -79.996],
  ["Harrisburg", "PA", 40.274, -76.884],
  ["Allentown", "PA", 40.608, -75.49],
  ["Newark", "NJ", 40.736, -74.172],
  ["Elizabeth", "NJ", 40.664, -74.211],
  ["Edison", "NJ", 40.519, -74.412],
  ["New York", "NY", 40.713, -74.006],
  ["Buffalo", "NY", 42.886, -78.878],
  ["Albany", "NY", 42.653, -73.756],
  ["Syracuse", "NY", 43.049, -76.147],
  ["Boston", "MA", 42.36, -71.059],
  ["Worcester", "MA", 42.263, -71.802],
  ["Hartford", "CT", 41.764, -72.685],
  ["Providence", "RI", 41.824, -71.413],
  ["Portland", "ME", 43.659, -70.257],
  ["Anchorage", "AK", 61.218, -149.9],
  ["Honolulu", "HI", 21.307, -157.858],
  ["Fayetteville", "GA", 33.449, -84.455],
  // Canada & Mexico
  ["Toronto", "ON", 43.653, -79.383, "CA"],
  ["Montreal", "QC", 45.502, -73.567, "CA"],
  ["Vancouver", "BC", 49.283, -123.121, "CA"],
  ["Calgary", "AB", 51.045, -114.072, "CA"],
  ["Winnipeg", "MB", 49.895, -97.138, "CA"],
  ["Monterrey", "NL", 25.686, -100.316, "MX"],
  ["Mexico City", "CDMX", 19.433, -99.133, "MX"],
  ["Guadalajara", "JAL", 20.659, -103.349, "MX"],
  ["Nuevo Laredo", "TAM", 27.476, -99.516, "MX"],
  ["Tijuana", "BC", 32.515, -117.038, "MX"],
  // Major world ports (ocean legs)
  ["Shanghai", "CN", 31.23, 121.474, "CN"],
  ["Shenzhen", "CN", 22.543, 114.058, "CN"],
  ["Ningbo", "CN", 29.868, 121.544, "CN"],
  ["Hong Kong", "HK", 22.319, 114.169, "HK"],
  ["Singapore", "SG", 1.29, 103.852, "SG"],
  ["Busan", "KR", 35.18, 129.076, "KR"],
  ["Tokyo", "JP", 35.676, 139.65, "JP"],
  ["Rotterdam", "NL", 51.924, 4.478, "NL"],
  ["Antwerp", "BE", 51.219, 4.402, "BE"],
  ["Hamburg", "DE", 53.551, 9.994, "DE"],
  ["Felixstowe", "GB", 51.962, 1.351, "GB"],
  ["Dubai", "AE", 25.205, 55.271, "AE"],
  ["Mumbai", "IN", 19.076, 72.878, "IN"],
];

export const PLACES: readonly Place[] = ROWS.map(([city, region, lat, lon, country]) => ({
  name: country && country !== "US" && region === country ? city : `${city}, ${region}`,
  lat,
  lon,
  region,
  country: country ?? "US",
}));

function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/\bsaint\b/g, "st")
    .replace(/[.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const BY_KEY = new Map<string, Place>();
for (const place of PLACES) {
  const [city] = place.name.split(",");
  BY_KEY.set(norm(`${city}, ${place.region}`), place);
  // Bare city name resolves to the first (most freight-relevant) entry.
  if (!BY_KEY.has(norm(city))) BY_KEY.set(norm(city), place);
}

/** Local lookup for "City, ST" / "City" strings. Null when not in the list. */
export function lookupPlace(text: string | null | undefined): Place | null {
  if (!text) return null;
  const cleaned = norm(text.replace(/\b\d{5}(-\d{4})?\b/g, "").replace(/,?\s*(usa|us|united states)$/i, ""));
  if (!cleaned) return null;
  const direct = BY_KEY.get(cleaned);
  if (direct) return direct;
  // "Chicago IL" without a comma, or extra detail like "Port of Oakland, CA".
  const match = cleaned.match(/^(?:port of\s+)?(.+?)[,\s]+([a-z]{2,4})$/);
  if (match) {
    const hit = BY_KEY.get(`${match[1].trim()}, ${match[2]}`);
    if (hit) return hit;
  }
  return BY_KEY.get(cleaned.replace(/^port of\s+/, "").split(",")[0].trim()) ?? null;
}
