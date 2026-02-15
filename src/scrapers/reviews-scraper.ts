/**
 * Google Reviews & Business Data Scraper
 * ───────────────────────────────────────
 * Extracts Google Business reviews, ratings, response rates,
 * photos, Q&A, and business details for any location.
 *
 * Uses Proxies.sx mobile proxies for authentic mobile responses.
 */

import { proxyFetch } from '../proxy';
import { decodeHtmlEntities } from '../utils/helpers';
import type {
  ReviewData,
  BusinessInfo,
  ReviewSummary,
  RatingDistribution,
  ReviewsResponse,
  BusinessResponse,
  ReviewSummaryResponse,
  ReviewSearchResponse,
  BusinessHours,
} from '../types';

// ─── MOBILE USER AGENTS ─────────────────────────────

const MOBILE_USER_AGENTS = [
  'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 13; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
];

function getRandomUserAgent(): string {
  return MOBILE_USER_AGENTS[Math.floor(Math.random() * MOBILE_USER_AGENTS.length)];
}

// ─── URL BUILDERS ───────────────────────────────────

function buildPlaceUrl(placeId: string): string {
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}&hl=en`;
}

function buildReviewsUrl(placeId: string, sort: string = 'newest'): string {
  // Google Maps sort: 1=most relevant, 2=newest, 3=highest, 4=lowest
  const sortMap: Record<string, string> = {
    'relevant': '1',
    'newest': '2',
    'highest': '3',
    'lowest': '4',
  };
  const sortParam = sortMap[sort] || '2';
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}&hl=en&sort=${sortParam}`;
}

function buildSearchUrl(query: string, location: string): string {
  const searchTerm = encodeURIComponent(`${query} in ${location}`);
  return `https://www.google.com/maps/search/${searchTerm}?hl=en`;
}

function buildLocalSearchUrl(query: string, location: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query + ' in ' + location)}&tbm=lcl&gbv=1&hl=en`;
}

// ─── HTML FETCHING ──────────────────────────────────

async function fetchGoogleMapsPage(url: string): Promise<string> {
  console.log(`[REVIEWS] Fetching: ${url}`);

  const response = await proxyFetch(url, {
    timeoutMs: 45000,
    maxRetries: 2,
    headers: {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  if (!response.ok) {
    throw new Error(`Google returned HTTP ${response.status}`);
  }

  const html = await response.text();
  console.log(`[REVIEWS] HTML length: ${html.length}`);

  // Check for CAPTCHA
  if (html.includes('captcha') || html.includes('unusual traffic')) {
    throw new Error('Google CAPTCHA detected. Mobile proxy may be flagged — try a different proxy region.');
  }

  return html;
}

// ─── BUSINESS INFO EXTRACTION ───────────────────────

/**
 * Extract business information from Google Maps HTML
 */
function extractBusinessInfo(html: string, placeId: string): BusinessInfo {
  const info: BusinessInfo = {
    name: '',
    placeId,
    rating: null,
    totalReviews: null,
    address: null,
    phone: null,
    website: null,
    hours: null,
    category: null,
    categories: [],
    priceLevel: null,
    photos: [],
    coordinates: null,
    permanentlyClosed: false,
  };

  // Extract name — try multiple patterns
  const namePatterns = [
    /<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i,
    /<title>([^<]+?)(?:\s*[-–|·]\s*Google Maps)?<\/title>/i,
    /"name"\s*:\s*"([^"]+)"/,
    /data-header-feature-name="([^"]+)"/i,
    /class="[^"]*DUwDvf[^"]*"[^>]*>([^<]+)/i,
    /aria-label="([^"]+?)(?:\s+reviews?)"/i,
  ];

  for (const pattern of namePatterns) {
    const match = html.match(pattern);
    if (match && match[1].trim().length > 1) {
      info.name = decodeHtmlEntities(match[1].trim());
      break;
    }
  }

  // Extract rating
  const ratingPatterns = [
    /"ratingValue"\s*:\s*"?([\d.]+)"?/,
    /aria-label="([\d.]+)\s+stars?"/i,
    /class="[^"]*(?:Aq14fc|fontDisplayLarge)[^"]*"[^>]*>([\d.]+)/i,
    /"aggregateRating"[^}]*"ratingValue"\s*:\s*"?([\d.]+)"?/,
  ];

  for (const pattern of ratingPatterns) {
    const match = html.match(pattern);
    if (match) {
      const rating = parseFloat(match[1]);
      if (rating >= 1 && rating <= 5) {
        info.rating = rating;
        break;
      }
    }
  }

  // Extract total reviews
  const reviewCountPatterns = [
    /"reviewCount"\s*:\s*"?(\d+)"?/,
    /([\d,]+)\s+reviews?/i,
    /aria-label="[\d.]+ stars?,?\s*([\d,]+)\s+reviews?"/i,
    /class="[^"]*(?:F7nice|fontBodyMedium)[^"]*"[^>]*>\(?([\d,]+)\)?/i,
  ];

  for (const pattern of reviewCountPatterns) {
    const match = html.match(pattern);
    if (match) {
      const count = parseInt(match[1].replace(/,/g, ''));
      if (count > 0) {
        info.totalReviews = count;
        break;
      }
    }
  }

  // Extract address
  const addressPatterns = [
    /"address"\s*:\s*"([^"]+)"/,
    /"streetAddress"\s*:\s*"([^"]+)"/,
    /data-item-id="address"[^>]*>[\s\S]*?<[^>]*>([^<]+)/i,
    /aria-label="Address[:\s]*([^"]+)"/i,
    /class="[^"]*(?:Io6YTe|rogA2c)[^"]*"[^>]*>([^<]+)/i,
  ];

  for (const pattern of addressPatterns) {
    const match = html.match(pattern);
    if (match && match[1].trim().length > 5) {
      info.address = decodeHtmlEntities(match[1].trim());
      break;
    }
  }

  // Extract phone
  const phonePatterns = [
    /"telephone"\s*:\s*"([^"]+)"/,
    /data-item-id="phone[^"]*"[^>]*>[\s\S]*?<[^>]*>([^<]+)/i,
    /aria-label="Phone[:\s]*([^"]+)"/i,
    /href="tel:([^"]+)"/i,
    /(\+?1?\s*[-.(]?\d{3}[-.)]\s*\d{3}[-.\s]\d{4})/,
  ];

  for (const pattern of phonePatterns) {
    const match = html.match(pattern);
    if (match && match[1].trim().length >= 7) {
      info.phone = decodeHtmlEntities(match[1].trim());
      break;
    }
  }

  // Extract website
  const websitePatterns = [
    /"url"\s*:\s*"(https?:\/\/(?!google\.com)[^"]+)"/,
    /data-item-id="authority"[^>]*>[\s\S]*?href="([^"]+)"/i,
    /aria-label="Website[:\s]*([^"]+)"/i,
  ];

  for (const pattern of websitePatterns) {
    const match = html.match(pattern);
    if (match && match[1].startsWith('http') && !match[1].includes('google.com')) {
      info.website = match[1];
      break;
    }
  }

  // Extract category
  const categoryPatterns = [
    /"@type"\s*:\s*"([^"]+)"(?!.*"@context")/,
    /data-item-id="category"[^>]*>[\s\S]*?<[^>]*>([^<]+)/i,
    /class="[^"]*(?:DkEaL|fontBodyMedium)[^"]*"[^>]*>([^<]+(?:restaurant|shop|store|bar|cafe|hotel|salon|gym|clinic|dentist|hospital|pharmacy|bank|school)[^<]*)/i,
    /jsaction="pane\.rating\.category"[^>]*>([^<]+)/i,
  ];

  for (const pattern of categoryPatterns) {
    const match = html.match(pattern);
    if (match && match[1].trim().length > 2 && match[1].trim().length < 100) {
      info.category = decodeHtmlEntities(match[1].trim());
      info.categories = [info.category];
      break;
    }
  }

  // Extract hours
  const hoursMatch = html.match(/"openingHours"\s*:\s*\[([^\]]+)\]/);
  if (hoursMatch) {
    try {
      const hoursArray = JSON.parse(`[${hoursMatch[1]}]`) as string[];
      const hours: BusinessHours = {};
      for (const entry of hoursArray) {
        const parts = entry.match(/^(\w+)[\s:]+(.+)$/);
        if (parts) {
          hours[parts[1]] = parts[2];
        }
      }
      if (Object.keys(hours).length > 0) {
        info.hours = hours;
      }
    } catch { /* ignore parse errors */ }
  }

  // Extract hours from aria-label pattern
  if (!info.hours) {
    const hoursLabelMatch = html.match(/aria-label="([^"]*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[^"]*)"/i);
    if (hoursLabelMatch) {
      const hours: BusinessHours = {};
      const dayPattern = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[,:;\s]+([^,;]+?)(?=(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|$)/gi;
      let dayMatch;
      while ((dayMatch = dayPattern.exec(hoursLabelMatch[1])) !== null) {
        hours[dayMatch[1]] = dayMatch[2].trim();
      }
      if (Object.keys(hours).length > 0) {
        info.hours = hours;
      }
    }
  }

  // Extract coordinates
  const coordPatterns = [
    /"geo"\s*:\s*\{[^}]*"latitude"\s*:\s*([-\d.]+)[^}]*"longitude"\s*:\s*([-\d.]+)/,
    /@([-\d.]+),([-\d.]+)/,
    /center=([-\d.]+)%2C([-\d.]+)/,
    /ll=([-\d.]+),([-\d.]+)/,
  ];

  for (const pattern of coordPatterns) {
    const match = html.match(pattern);
    if (match) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        info.coordinates = { latitude: lat, longitude: lng };
        break;
      }
    }
  }

  // Extract price level
  const priceMatch = html.match(/aria-label="Price[:\s]*([^"]+)"/i) ||
                     html.match(/"priceRange"\s*:\s*"([^"]+)"/);
  if (priceMatch) {
    info.priceLevel = priceMatch[1].trim();
  }

  // Check if permanently closed
  info.permanentlyClosed = /permanently closed/i.test(html) || /Permanently closed/i.test(html);

  // Extract photos
  const photoPattern = /https:\/\/lh[35]\.googleusercontent\.com\/[a-zA-Z0-9_\-\/=]+/g;
  const photoMatches = html.match(photoPattern) || [];
  const uniquePhotos = [...new Set(photoMatches)].slice(0, 10);
  info.photos = uniquePhotos;

  return info;
}

// ─── REVIEW EXTRACTION ──────────────────────────────

/**
 * Extract individual reviews from Google Maps HTML
 */
function extractReviews(html: string, limit: number = 20): ReviewData[] {
  const reviews: ReviewData[] = [];

  // Strategy 1: Extract from JSON-LD / embedded data
  const reviewJsonPattern = /"review"\s*:\s*\[([\s\S]*?)\](?=\s*[,}])/;
  const jsonMatch = html.match(reviewJsonPattern);

  if (jsonMatch) {
    try {
      const reviewsData = JSON.parse(`[${jsonMatch[1]}]`);
      for (const r of reviewsData) {
        if (reviews.length >= limit) break;
        reviews.push({
          author: r.author?.name || r.author || 'Anonymous',
          rating: parseInt(r.reviewRating?.ratingValue || r.rating) || 0,
          text: decodeHtmlEntities(r.reviewBody || r.text || ''),
          date: r.datePublished || r.date || '',
          relativeDate: null,
          likes: parseInt(r.likes) || 0,
          ownerResponse: r.ownerResponse?.text || r.owner_response || null,
          ownerResponseDate: r.ownerResponse?.datePublished || null,
          photos: [],
        });
      }
    } catch { /* fallback to HTML parsing */ }
  }

  // Strategy 2: Parse from HTML review blocks
  if (reviews.length === 0) {
    // Google Maps review containers — multiple CSS class patterns
    const reviewBlockPatterns = [
      /class="[^"]*(?:jftiEf|gws-localreviews__google-review)[^"]*"[\s\S]*?(?=class="[^"]*(?:jftiEf|gws-localreviews__google-review)[^"]*"|<\/div>\s*<\/div>\s*<\/div>\s*$)/gi,
      /data-review-id="[^"]*"[\s\S]*?(?=data-review-id="|$)/gi,
      /class="[^"]*review-dialog-list[^"]*"[\s\S]*?class="[^"]*(?:review-snippet)[^"]*"/gi,
    ];

    for (const blockPattern of reviewBlockPatterns) {
      const blocks = html.match(blockPattern) || [];
      for (const block of blocks) {
        if (reviews.length >= limit) break;
        const review = parseReviewBlock(block);
        if (review && review.author && review.text) {
          reviews.push(review);
        }
      }
      if (reviews.length > 0) break;
    }
  }

  // Strategy 3: Extract from search results page review snippets
  if (reviews.length === 0) {
    const snippetPattern = /class="[^"]*(?:review-snippet|Jtu6Td|OA1nbd)[^"]*"[\s\S]*?<\/div>/gi;
    const snippets = html.match(snippetPattern) || [];
    for (const snippet of snippets) {
      if (reviews.length >= limit) break;
      const review = parseReviewSnippet(snippet);
      if (review) {
        reviews.push(review);
      }
    }
  }

  return reviews;
}

/**
 * Parse a single review block from Google Maps HTML
 */
function parseReviewBlock(block: string): ReviewData | null {
  // Extract author
  const authorMatch = block.match(/class="[^"]*(?:d4r55|TSUbDb|lTi8oc)[^"]*"[^>]*>([^<]+)/i) ||
                      block.match(/aria-label="([^"]+)'s? review/i) ||
                      block.match(/class="[^"]*author[^"]*"[^>]*>([^<]+)/i);
  const author = authorMatch ? decodeHtmlEntities(authorMatch[1].trim()) : null;

  // Extract rating
  const ratingMatch = block.match(/aria-label="(\d)\s+stars?"/i) ||
                      block.match(/class="[^"]*(?:kvMYJc|hCCjke)[^"]*"[^>]*aria-label="[^"]*?(\d)/i) ||
                      block.match(/data-rating="(\d)"/i);
  const rating = ratingMatch ? parseInt(ratingMatch[1]) : 0;

  // Extract text
  const textMatch = block.match(/class="[^"]*(?:wiI7pd|review-full-text|Jtu6Td)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)/i) ||
                    block.match(/class="[^"]*(?:rsqaWe)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)/i);
  const text = textMatch ? decodeHtmlEntities(textMatch[1].replace(/<[^>]+>/g, '').trim()) : '';

  // Extract date
  const dateMatch = block.match(/class="[^"]*(?:rsqaWe|dehysf)[^"]*"[^>]*>([^<]*(?:ago|week|month|year|day|hour)[^<]*)/i) ||
                    block.match(/(\d{4}-\d{2}-\d{2})/);
  const relativeDate = dateMatch ? decodeHtmlEntities(dateMatch[1].trim()) : null;
  const date = parseDateString(relativeDate);

  // Extract likes/helpful count
  const likesMatch = block.match(/(\d+)\s+(?:people|person)?\s*(?:found this|helpful)/i) ||
                     block.match(/class="[^"]*(?:pkWtMe)[^"]*"[^>]*>(\d+)/i);
  const likes = likesMatch ? parseInt(likesMatch[1]) : 0;

  // Extract owner response
  const ownerMatch = block.match(/class="[^"]*(?:CDe7pd|owner-response)[^"]*"[\s\S]*?class="[^"]*(?:wiI7pd|review-full-text)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)/i);
  const ownerResponse = ownerMatch ? decodeHtmlEntities(ownerMatch[1].replace(/<[^>]+>/g, '').trim()) : null;

  // Extract owner response date
  const ownerDateMatch = block.match(/class="[^"]*(?:CDe7pd|owner-response)[^"]*"[\s\S]*?class="[^"]*(?:rsqaWe|dehysf)[^"]*"[^>]*>([^<]+)/i);
  const ownerResponseDate = ownerDateMatch ? decodeHtmlEntities(ownerDateMatch[1].trim()) : null;

  // Extract review photos
  const photoMatches = block.match(/https:\/\/lh[35]\.googleusercontent\.com\/[a-zA-Z0-9_\-\/=]+/g) || [];
  const photos = [...new Set(photoMatches)].slice(0, 5);

  if (!author && !text) return null;

  return {
    author: author || 'Anonymous',
    rating,
    text,
    date,
    relativeDate,
    likes,
    ownerResponse,
    ownerResponseDate,
    photos,
  };
}

/**
 * Parse a review snippet from search results
 */
function parseReviewSnippet(snippet: string): ReviewData | null {
  const authorMatch = snippet.match(/>([^<]+?)\s*(?:wrote|posted|reviewed)/i) ||
                      snippet.match(/class="[^"]*(?:TSUbDb|lTi8oc)[^"]*"[^>]*>([^<]+)/i);
  const textMatch = snippet.match(/"([^"]{20,})"/i) ||
                    snippet.match(/class="[^"]*(?:Jtu6Td|OA1nbd)[^"]*"[^>]*>([^<]+)/i);
  const ratingMatch = snippet.match(/(\d)\s*(?:\/5|stars?|out of)/i);

  if (!textMatch) return null;

  return {
    author: authorMatch ? decodeHtmlEntities(authorMatch[1].trim()) : 'Anonymous',
    rating: ratingMatch ? parseInt(ratingMatch[1]) : 0,
    text: decodeHtmlEntities(textMatch[1].trim()),
    date: '',
    relativeDate: null,
    likes: 0,
    ownerResponse: null,
    ownerResponseDate: null,
    photos: [],
  };
}

// ─── RATING DISTRIBUTION EXTRACTION ─────────────────

/**
 * Extract rating distribution (1-5 star breakdown) from HTML
 */
function extractRatingDistribution(html: string): RatingDistribution {
  const dist: RatingDistribution = { '5': 0, '4': 0, '3': 0, '2': 0, '1': 0 };

  // Pattern 1: aria-label with star counts
  const ariaPattern = /aria-label="(\d)\s+stars?,?\s*(\d[\d,]*)\s+reviews?"/gi;
  let match;
  while ((match = ariaPattern.exec(html)) !== null) {
    const star = match[1] as keyof RatingDistribution;
    if (star in dist) {
      dist[star] = parseInt(match[2].replace(/,/g, ''));
    }
  }

  // Pattern 2: percentage bars with counts
  if (Object.values(dist).every(v => v === 0)) {
    for (let i = 5; i >= 1; i--) {
      const countPattern = new RegExp(`${i}\\s+stars?[\\s\\S]*?(\\d[\\d,]*)`, 'i');
      const countMatch = html.match(countPattern);
      if (countMatch) {
        dist[String(i) as keyof RatingDistribution] = parseInt(countMatch[1].replace(/,/g, ''));
      }
    }
  }

  // Pattern 3: percentage-based distribution (convert to counts using total)
  if (Object.values(dist).every(v => v === 0)) {
    const totalMatch = html.match(/([\d,]+)\s+(?:total\s+)?reviews?/i);
    const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g, '')) : 0;

    if (total > 0) {
      const pctPattern = /(\d)\s+stars?\s*[\s\S]*?(\d+)%/gi;
      while ((match = pctPattern.exec(html)) !== null) {
        const star = match[1] as keyof RatingDistribution;
        if (star in dist) {
          dist[star] = Math.round(total * parseInt(match[2]) / 100);
        }
      }
    }
  }

  return dist;
}

// ─── REVIEW SUMMARY CALCULATION ─────────────────────

/**
 * Calculate review summary statistics from reviews and business info
 */
function calculateSummary(reviews: ReviewData[], info: BusinessInfo, dist: RatingDistribution): ReviewSummary {
  // Calculate response rate from reviews
  const reviewsWithOwnerResponse = reviews.filter(r => r.ownerResponse !== null).length;
  const responseRate = reviews.length > 0
    ? Math.round((reviewsWithOwnerResponse / reviews.length) * 100)
    : 0;

  // Calculate average response time (estimate from relative dates)
  let avgResponseTimeDays: number | null = null;

  // Sentiment breakdown from ratings
  const rated = reviews.filter(r => r.rating > 0);
  const positive = rated.filter(r => r.rating >= 4).length;
  const neutral = rated.filter(r => r.rating === 3).length;
  const negative = rated.filter(r => r.rating <= 2).length;
  const totalRated = rated.length || 1;

  return {
    avgRating: info.rating,
    totalReviews: info.totalReviews,
    ratingDistribution: dist,
    responseRate,
    avgResponseTimeDays,
    sentimentBreakdown: {
      positive: Math.round((positive / totalRated) * 100),
      neutral: Math.round((neutral / totalRated) * 100),
      negative: Math.round((negative / totalRated) * 100),
    },
  };
}

// ─── SEARCH EXTRACTION ──────────────────────────────

/**
 * Extract business listings from Google Maps search results
 */
function extractSearchResults(html: string): BusinessInfo[] {
  const businesses: BusinessInfo[] = [];
  const seenNames = new Set<string>();

  function isValidBusinessName(name: string): boolean {
    if (!name || name.length < 2 || name.length > 80) return false;
    if (/[{}();=+\\]/.test(name)) return false; // JS code fragments
    if (/^\d+$/.test(name)) return false;
    if (/^https?:\/\//.test(name)) return false;
    if (/^[a-f0-9]{20,}$/i.test(name)) return false; // hex hashes
    if (/^ChIJ/.test(name)) return false; // place IDs
    if (/function|var |let |const |return |null|undefined|true|false|window\./i.test(name)) return false;
    if (!/[a-zA-Z]/.test(name)) return false; // must have at least one letter
    return true;
  }

  function addBusiness(info: BusinessInfo): void {
    if (isValidBusinessName(info.name) && !seenNames.has(info.name)) {
      seenNames.add(info.name);
      businesses.push(info);
    }
  }

  function emptyBusiness(name: string, placeId: string = ''): BusinessInfo {
    return {
      name: decodeHtmlEntities(name.trim()),
      placeId,
      rating: null,
      totalReviews: null,
      address: null,
      phone: null,
      website: null,
      hours: null,
      category: null,
      categories: [],
      priceLevel: null,
      photos: [],
      coordinates: null,
      permanentlyClosed: false,
    };
  }

  // Strategy 1: Parse embedded JS data arrays (works even on JS-heavy pages)
  // Google Maps embeds structured data in arrays like [null,null,null,[...business data...]]
  const jsDataPattern = /\["([^"]{2,80})",\s*"[^"]*",\s*"[^"]*",\s*"[^"]*"\s*,\s*([\d.]+)\s*,\s*[\d,]*\s*,/g;
  let jm;
  while ((jm = jsDataPattern.exec(html)) !== null) {
    const name = jm[1];
    if (name.length > 2 && name.length < 80 && !/^http|^\/|^\d+$/.test(name)) {
      const info = emptyBusiness(name);
      info.rating = parseFloat(jm[2]) || null;
      addBusiness(info);
    }
  }

  // Strategy 2: Extract from window.APP_INITIALIZATION_STATE or similar JS blobs
  // These contain arrays like: [place_name, address, lat, lng, place_id, ...]
  const appStateMatches = html.match(/\[\\"([^\\]{3,80})\\",\\"([^\\]{5,200})\\"/g) || [];
  for (const asm of appStateMatches) {
    const parts = asm.match(/\[\\"([^\\]+)\\",\\"([^\\]+)\\"/);
    if (parts && parts[1].length > 2 && parts[1].length < 80 && !/^http|^\/|^\d+$/.test(parts[1])) {
      const info = emptyBusiness(parts[1]);
      if (parts[2] && parts[2].length > 5 && parts[2].length < 200) {
        info.address = decodeHtmlEntities(parts[2]);
      }
      addBusiness(info);
    }
  }

  // Strategy 3: Extract from JSON-LD blocks
  const jsonLdPattern = /"@type"\s*:\s*"(?:LocalBusiness|Restaurant|Store|Hotel|[A-Z]\w+)"[\s\S]*?(?="@type"|$)/g;
  let match;
  while ((match = jsonLdPattern.exec(html)) !== null) {
    const block = match[0];
    const nameMatch = block.match(/"name"\s*:\s*"([^"]+)"/);
    if (nameMatch) {
      const info = extractBusinessInfo(block, '');
      info.name = decodeHtmlEntities(nameMatch[1]);
      addBusiness(info);
    }
  }

  // Strategy 4: Extract from search result cards (mobile HTML)
  if (businesses.length === 0) {
    const cardPatterns = [
      /class="[^"]*(?:Nv2PK|qBF1Pd)[^"]*"[\s\S]*?(?=class="[^"]*(?:Nv2PK|qBF1Pd)[^"]*"|$)/gi,
      /data-result-index="\d+"[\s\S]*?(?=data-result-index="|$)/gi,
    ];

    for (const cardPattern of cardPatterns) {
      const cards = html.match(cardPattern) || [];
      for (const card of cards) {
        const nameMatch = card.match(/class="[^"]*(?:qBF1Pd|fontHeadlineSmall|NrDZNb)[^"]*"[^>]*>([^<]+)/i) ||
                          card.match(/aria-label="([^"]+)"/i);
        if (nameMatch) {
          const info = emptyBusiness(nameMatch[1]);

          const ratingMatch = card.match(/([\d.]+)\s*(?:stars?|\()/i);
          if (ratingMatch) info.rating = parseFloat(ratingMatch[1]);

          const countMatch = card.match(/\(([\d,]+)\)/);
          if (countMatch) info.totalReviews = parseInt(countMatch[1].replace(/,/g, ''));

          const addrMatch = card.match(/class="[^"]*(?:W4Efsd|fontBodyMedium)[^"]*"[^>]*>[\s\S]*?·[\s\S]*?([^<·]+)/i);
          if (addrMatch) info.address = decodeHtmlEntities(addrMatch[1].trim());

          const catMatch = card.match(/class="[^"]*(?:W4Efsd|fontBodyMedium)[^"]*"[^>]*>([^<·]+)/i);
          if (catMatch && catMatch[1].trim().length < 50) {
            info.category = decodeHtmlEntities(catMatch[1].trim());
            info.categories = [info.category];
          }

          const placeIdMatch = card.match(/data-cid="([^"]+)"/i) || card.match(/place_id[=:]([A-Za-z0-9_-]+)/i);
          if (placeIdMatch) info.placeId = placeIdMatch[1];

          addBusiness(info);
        }
      }
      if (businesses.length > 0) break;
    }
  }

  // Strategy 5: Extract business names from aria-label attributes
  if (businesses.length === 0) {
    const ariaLabels = html.match(/aria-label="([^"]{3,80})"/gi) || [];
    for (const al of ariaLabels) {
      const nameMatch = al.match(/aria-label="([^"]+)"/i);
      if (nameMatch) {
        const name = nameMatch[1].trim();
        if (name.length > 2 && name.length < 80 && 
            !/directions|close|search|menu|zoom|map|back|filter|clear|share|save|sign/i.test(name) &&
            !/^\d+$/.test(name)) {
          addBusiness(emptyBusiness(name));
        }
      }
    }
  }

  // Strategy 6: Extract from Google Maps internal data format (\\x22name\\x22:\\x22...\\x22)
  if (businesses.length === 0) {
    const hexNames = html.match(/\\x22([^\\]{3,80})\\x22,\\x22([^\\]{0,200})\\x22/g) || [];
    for (const hex of hexNames) {
      const parts = hex.match(/\\x22([^\\]+)\\x22,\\x22([^\\]*)\\x22/);
      if (parts && parts[1].length > 2 && parts[1].length < 80 &&
          !/^http|^\/|^\d+$|^[a-f0-9]+$|^ChIJ/.test(parts[1]) &&
          /[A-Z]/.test(parts[1])) {
        const info = emptyBusiness(parts[1]);
        if (parts[2] && parts[2].length > 5 && parts[2].length < 200 && /\d/.test(parts[2])) {
          info.address = decodeHtmlEntities(parts[2]);
        }
        addBusiness(info);
      }
    }
  }

  console.log(`[REVIEWS] Search extraction strategies found ${businesses.length} businesses`);
  return businesses;
}

// ─── HELPER FUNCTIONS ───────────────────────────────

/**
 * Parse relative date string to ISO date
 */
function parseDateString(dateStr: string | null): string {
  if (!dateStr) return '';

  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr;

  const now = new Date();

  // Parse relative dates like "2 weeks ago", "3 months ago"
  const relMatch = dateStr.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/i);
  if (relMatch) {
    const amount = parseInt(relMatch[1]);
    const unit = relMatch[2].toLowerCase();

    switch (unit) {
      case 'second': now.setSeconds(now.getSeconds() - amount); break;
      case 'minute': now.setMinutes(now.getMinutes() - amount); break;
      case 'hour': now.setHours(now.getHours() - amount); break;
      case 'day': now.setDate(now.getDate() - amount); break;
      case 'week': now.setDate(now.getDate() - amount * 7); break;
      case 'month': now.setMonth(now.getMonth() - amount); break;
      case 'year': now.setFullYear(now.getFullYear() - amount); break;
    }

    return now.toISOString().split('T')[0];
  }

  // "a week ago", "a month ago"
  const singleMatch = dateStr.match(/an?\s*(hour|day|week|month|year)\s*ago/i);
  if (singleMatch) {
    const unit = singleMatch[1].toLowerCase();
    switch (unit) {
      case 'hour': now.setHours(now.getHours() - 1); break;
      case 'day': now.setDate(now.getDate() - 1); break;
      case 'week': now.setDate(now.getDate() - 7); break;
      case 'month': now.setMonth(now.getMonth() - 1); break;
      case 'year': now.setFullYear(now.getFullYear() - 1); break;
    }
    return now.toISOString().split('T')[0];
  }

  return dateStr;
}

// ─── GOOGLE SEARCH FALLBACK ─────────────────────────

/** Extract basic business info from Google Search results page (fallback when Maps gives sparse data) */
function extractBusinessFromSearch(html: string, placeId: string): BusinessInfo {
  const info: BusinessInfo = {
    name: '',
    placeId,
    rating: null,
    totalReviews: null,
    address: null,
    phone: null,
    website: null,
    hours: null,
    category: null,
    categories: [],
    priceLevel: null,
    photos: [],
    coordinates: null,
    permanentlyClosed: false,
  };

  // Extract name from Knowledge Panel title or heading
  const titleMatch = html.match(/<div[^>]*data-attrid="title"[^>]*>([^<]+)</i) ||
                     html.match(/<h2[^>]*data-attrid="title"[^>]*>([^<]+)</i) ||
                     html.match(/class="[^"]*(?:qrShPb|SPZz6b|PZPZlf)[^"]*"[^>]*>([^<]+)/i) ||
                     html.match(/<title>([^<]+?)(?:\s*[-–|].*)?<\/title>/i);
  if (titleMatch) {
    let name = decodeHtmlEntities(titleMatch[1].trim());
    name = name.replace(/\s*[-–|].*$/, '').replace(/\s*- Google.*$/, '').trim();
    const genericNames = /^(google|search|maps|place_id|sign in|error|404|not found)/i;
    if (name.length > 1 && name.length < 100 && !genericNames.test(name)) info.name = name;
  }

  // Extract rating
  const ratingMatch = html.match(/class="[^"]*(?:Aq14fc|oqSTJd)[^"]*"[^>]*>([\d.]+)/i) ||
                      html.match(/aria-label="Rated ([\d.]+)/i);
  if (ratingMatch) info.rating = parseFloat(ratingMatch[1]);

  // Extract review count
  const countMatch = html.match(/\(([\d,]+)\s*(?:review|rating)/i) ||
                     html.match(/([\d,]+)\s*(?:Google )?reviews?/i);
  if (countMatch) info.totalReviews = parseInt(countMatch[1].replace(/,/g, ''));

  // Extract address from Knowledge Panel
  const addrMatch = html.match(/data-attrid="kc:\/location\/address"[^>]*>[\s\S]*?class="[^"]*(?:LrzXr|hgKElc)[^"]*"[^>]*>([^<]+)/i) ||
                    html.match(/class="[^"]*LrzXr[^"]*"[^>]*>([^<]*\d[^<]*(?:St|Ave|Blvd|Rd|Dr|Ln|Way|Ct|Pl)[^<]*)/i);
  if (addrMatch) info.address = decodeHtmlEntities(addrMatch[1].trim());

  // Extract phone
  const phoneMatch = html.match(/data-attrid="kc:\/collection\/knowledge_panels\/has_phone[^"]*"[^>]*>[\s\S]*?(\+?[\d\s\-().]{10,})/i) ||
                     html.match(/class="[^"]*LrzXr[^"]*"[^>]*>(\+?1?\s*[\d\s\-().]{10,})/i);
  if (phoneMatch) info.phone = phoneMatch[1].trim();

  // Extract category
  const catMatch = html.match(/data-attrid="subtitle"[^>]*>[\s\S]*?class="[^"]*(?:YhemCb|hgKElc)[^"]*"[^>]*>([^<]+)/i) ||
                   html.match(/class="[^"]*(?:YhemCb)[^"]*"[^>]*>([^<]+)/i);
  if (catMatch) {
    info.category = decodeHtmlEntities(catMatch[1].trim());
    info.categories = [info.category];
  }

  console.log(`[REVIEWS] Google Search fallback extracted: "${info.name}", ${info.rating}★, ${info.totalReviews} reviews`);
  return info;
}

// ─── PUBLIC API FUNCTIONS ───────────────────────────

/**
 * Fetch reviews for a business by place ID
 */
export async function fetchReviews(
  placeId: string,
  sort: string = 'newest',
  limit: number = 20,
): Promise<ReviewsResponse> {
  const url = buildReviewsUrl(placeId, sort);
  const html = await fetchGoogleMapsPage(url);

  let business = extractBusinessInfo(html, placeId);
  const reviews = extractReviews(html, limit);

  // Fallback: if Maps page yielded no name, try Google Search
  if (!business.name) {
    console.log(`[REVIEWS] Maps returned sparse data for reviews, trying Google Search fallback...`);
    try {
      const fallbackUrl = `https://www.google.com/search?q=place_id:${encodeURIComponent(placeId)}&gbv=1&hl=en`;
      const fallbackHtml = await fetchGoogleMapsPage(fallbackUrl);
      const fallbackBiz = extractBusinessFromSearch(fallbackHtml, placeId);
      if (fallbackBiz.name) business = fallbackBiz;
    } catch { /* keep original */ }
  }

  console.log(`[REVIEWS] Extracted: ${reviews.length} reviews for "${business.name}"`);

  return {
    business,
    reviews,
    pagination: {
      total: business.totalReviews || reviews.length,
      returned: reviews.length,
      sort,
    },
  };
}

/**
 * Fetch detailed business info by place ID
 */
export async function fetchBusinessDetails(placeId: string): Promise<BusinessResponse> {
  const url = buildPlaceUrl(placeId);
  const html = await fetchGoogleMapsPage(url);

  let business = extractBusinessInfo(html, placeId);
  let reviews = extractReviews(html, 50);
  let dist = extractRatingDistribution(html);

  // Fallback: if Maps page yielded no name, try Google Search with place_id
  if (!business.name) {
    console.log(`[REVIEWS] Maps returned sparse data, trying Google Search fallback...`);
    const fallbackUrl = `https://www.google.com/search?q=place_id:${encodeURIComponent(placeId)}&gbv=1&hl=en`;
    try {
      const fallbackHtml = await fetchGoogleMapsPage(fallbackUrl);
      const fallbackBiz = extractBusinessFromSearch(fallbackHtml, placeId);
      if (fallbackBiz.name) business = fallbackBiz;
    } catch { /* fallback failed, keep original */ }
  }

  const summary = calculateSummary(reviews, business, dist);

  console.log(`[REVIEWS] Business: "${business.name}" — ${business.rating}★ (${business.totalReviews} reviews)`);

  return { business, summary };
}

/**
 * Fetch review summary/stats for a business
 */
export async function fetchReviewSummary(placeId: string): Promise<ReviewSummaryResponse> {
  const url = buildPlaceUrl(placeId);
  const html = await fetchGoogleMapsPage(url);

  let business = extractBusinessInfo(html, placeId);
  const reviews = extractReviews(html, 50);
  const dist = extractRatingDistribution(html);

  // Fallback: if Maps page yielded no name, try Google Search
  if (!business.name) {
    console.log(`[REVIEWS] Maps returned sparse data for summary, trying Google Search fallback...`);
    try {
      const fallbackUrl = `https://www.google.com/search?q=place_id:${encodeURIComponent(placeId)}&gbv=1&hl=en`;
      const fallbackHtml = await fetchGoogleMapsPage(fallbackUrl);
      const fallbackBiz = extractBusinessFromSearch(fallbackHtml, placeId);
      if (fallbackBiz.name) business = fallbackBiz;
    } catch { /* keep original */ }
  }

  const summary = calculateSummary(reviews, business, dist);

  console.log(`[REVIEWS] Summary: "${business.name}" — response rate: ${summary.responseRate}%`);

  return {
    business: {
      name: business.name,
      placeId: business.placeId,
      rating: business.rating,
      totalReviews: business.totalReviews,
    },
    summary,
  };
}

/**
 * Search businesses by query + location
 */
export async function searchBusinesses(
  query: string,
  location: string,
  limit: number = 10,
): Promise<ReviewSearchResponse> {
  // Try Google Maps search first
  const url = buildSearchUrl(query, location);
  let html = await fetchGoogleMapsPage(url);
  let businesses = extractSearchResults(html).slice(0, limit);

  // Fallback: try Google Local search (better HTML without proxies)
  if (businesses.length === 0) {
    console.log(`[REVIEWS] Maps search returned 0 results, trying local web search...`);
    const localUrl = buildLocalSearchUrl(query, location);
    html = await fetchGoogleMapsPage(localUrl);
    businesses = extractFromLocalSearch(html).slice(0, limit);
  }

  console.log(`[REVIEWS] Search: "${query} in ${location}" — found ${businesses.length} businesses`);

  return {
    query,
    location,
    businesses,
    totalFound: businesses.length,
  };
}

/** Extract businesses from Google Local Search results (tbm=lcl with gbv=1) */
function extractFromLocalSearch(html: string): BusinessInfo[] {
  const businesses: BusinessInfo[] = [];
  const seenNames = new Set<string>();

  function emptyBiz(name: string): BusinessInfo {
    return {
      name: decodeHtmlEntities(name.trim()),
      placeId: '',
      rating: null,
      totalReviews: null,
      address: null,
      phone: null,
      website: null,
      hours: null,
      category: null,
      categories: [],
      priceLevel: null,
      photos: [],
      coordinates: null,
      permanentlyClosed: false,
    };
  }

  // Google Local Search (gbv=1) returns cards in <div class="X7NTVe"> blocks
  // Name: <div class="ilUpNd XV43Ef aSRlid">Business Name</div> inside <h3>
  // Rating: <span class="oqSTJd">4.5</span>
  // Reviews: <span>(24,548)</span>
  // Category + Address: after <br>, like "Pizza ⋅ 1435 Broadway"
  // Price: "$10–20"
  // Place ID: ludocid=NNNN in the card link

  const cardPattern = /class="X7NTVe"[\s\S]*?(?=class="X7NTVe"|class="Q0HXG"><\/div><\/div>|<\/footer>)/gi;
  const cards = html.match(cardPattern) || [];

  for (const card of cards) {
    // Extract business name from h3 > div.aSRlid
    const nameMatch = card.match(/class="ilUpNd XV43Ef aSRlid">([^<]+)<\/div>/i);
    if (!nameMatch) continue;

    const name = nameMatch[1].trim();
    if (name.length < 2 || seenNames.has(name)) continue;
    seenNames.add(name);

    const info = emptyBiz(name);

    // Extract rating
    const ratingMatch = card.match(/class="oqSTJd">([\d.]+)<\/span>/);
    if (ratingMatch) info.rating = parseFloat(ratingMatch[1]);

    // Extract review count
    const countMatch = card.match(/\(([\d,]+)\)<\/span>/);
    if (countMatch) info.totalReviews = parseInt(countMatch[1].replace(/,/g, ''));

    // Extract price level
    const priceMatch = card.match(/(?:·|&middot;)\s*(\$[\d]+[–\-]\$?[\d]+)/);
    if (priceMatch) info.priceLevel = priceMatch[1];

    // Extract category and address from after <br>
    const catAddrMatch = card.match(/<br\s*\/?>\s*([^<]+)/);
    if (catAddrMatch) {
      const parts = catAddrMatch[1].split(/\s*[⋅·]\s*/);
      if (parts.length >= 2) {
        info.category = decodeHtmlEntities(parts[0].trim());
        info.categories = [info.category];
        info.address = decodeHtmlEntities(parts.slice(1).join(', ').trim());
      } else if (parts[0]) {
        info.address = decodeHtmlEntities(parts[0].trim());
      }
    }

    // Extract ludocid as place ID
    const ludocidMatch = card.match(/ludocid=(\d+)/);
    if (ludocidMatch) info.placeId = ludocidMatch[1];

    businesses.push(info);
  }

  console.log(`[REVIEWS] Local search extraction found ${businesses.length} businesses`);
  return businesses;
}
