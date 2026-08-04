const MODE_LABELS = {
  car: 'Car',
  flight: 'Plane',
  train: 'Train',
  bus: 'Bus',
};

const TRAVEL_REGIONS = {
  US: 'north-america',
  CA: 'north-america',
  MX: 'north-america',
  FR: 'europe',
  GB: 'europe',
  IT: 'europe',
  ES: 'europe',
  PT: 'europe',
  NL: 'europe',
  CH: 'europe',
  GR: 'europe',
  DE: 'europe',
  BE: 'europe',
  AT: 'europe',
  JP: 'east-asia',
  KR: 'east-asia',
  CN: 'east-asia',
  TH: 'southeast-asia',
  SG: 'southeast-asia',
  MY: 'southeast-asia',
  ID: 'southeast-asia',
  AE: 'middle-east',
  EG: 'north-africa',
  MA: 'north-africa',
  ZA: 'southern-africa',
  AU: 'oceania',
  MV: 'south-asia',
  IS: 'europe',
};

function distanceKm(a, b) {
  if (a?.lat == null || a?.lon == null || b?.lat == null || b?.lon == null) return null;
  const radius = 6371;
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = radians(Number(b.lat) - Number(a.lat));
  const dLon = radians(Number(b.lon) - Number(a.lon));
  const lat1 = radians(Number(a.lat));
  const lat2 = radians(Number(b.lat));
  const value = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(value));
}

function unavailableReason(mode, context) {
  if (context.airOnly) return 'This destination requires an air or island connection.';
  if (context.crossRegion) return `${MODE_LABELS[mode]} cannot make this overseas route.`;
  if (mode === 'train') return 'No practical through-train route for this distance.';
  if (mode === 'bus') return 'This route is too long for a useful bus trip.';
  if (mode === 'car') return 'This route is too far for a practical road trip.';
  if (mode === 'flight') return 'The destination is close enough that flying is not useful.';
  return 'Not practical from the selected starting point.';
}

export function getTravelAdvice(origin, destination, template = null) {
  const candidates = template?.modes || ['car', 'flight', 'train', 'bus'];
  const distance = distanceKm(origin, destination);
  if (distance == null) {
    return {
      available: candidates,
      recommended: template?.recommendedMode || null,
      unavailable: {},
      summary: 'Choose your starting point to check which transportation methods are practical.',
      distanceKm: null,
    };
  }

  const originCode = origin.countryCode || '';
  const destinationCode = destination.countryCode || template?.countryCode || '';
  const sameCountry = Boolean(originCode && destinationCode && originCode === destinationCode);
  const originRegion = TRAVEL_REGIONS[originCode];
  const destinationRegion = TRAVEL_REGIONS[destinationCode] || template?.travelRegion;
  const crossRegion = Boolean(
    originCode && destinationCode && !sameCountry &&
    (!originRegion || !destinationRegion || originRegion !== destinationRegion),
  );
  const airOnly = Boolean(template?.airOnly);
  let available;

  if (airOnly) {
    available = candidates.filter((mode) => mode === 'flight');
  } else if (crossRegion) {
    available = candidates.filter((mode) => mode === 'flight');
  } else if (distance < 120) {
    available = candidates.filter((mode) => ['car', 'bus', 'train'].includes(mode));
  } else if (sameCountry) {
    available = candidates.filter((mode) => {
      if (mode === 'flight') return distance >= 350;
      if (mode === 'train') return distance <= 1800;
      if (mode === 'bus') return distance <= 1200;
      if (mode === 'car') return distance <= 3500;
      return false;
    });
  } else {
    available = candidates.filter((mode) => {
      if (mode === 'flight') return distance >= 300;
      if (mode === 'train') return distance <= 1400;
      if (mode === 'bus') return distance <= 1000;
      if (mode === 'car') return distance <= 1600;
      return false;
    });
  }

  if (available.length === 0) {
    available = candidates.includes('flight') ? ['flight'] : [candidates[0]];
  }

  const recommended = available.includes('car') && distance < 650
    ? 'car'
    : available.includes('train') && distance < 1000
      ? 'train'
      : available.includes('flight')
        ? 'flight'
        : available[0];
  const context = { airOnly, crossRegion };
  const unavailable = Object.fromEntries(
    candidates
      .filter((mode) => !available.includes(mode))
      .map((mode) => [mode, unavailableReason(mode, context)]),
  );
  const miles = Math.round(distance * 0.621371);
  const summary = crossRegion
    ? `About ${miles.toLocaleString()} miles away and in another world region. Fly first, then continue locally.`
    : `About ${miles.toLocaleString()} miles from your starting point. ${MODE_LABELS[recommended]} is the most practical choice.`;

  return { available, recommended, unavailable, summary, distanceKm: distance };
}
