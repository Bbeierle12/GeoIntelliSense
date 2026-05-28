/**
 * Spatial Interpolation Algorithms
 * IDW (Inverse Distance Weighting), Kriging, and other interpolation methods
 */

// =============================================================================
// TYPES
// =============================================================================

export interface DataPoint {
  lat: number;
  lng: number;
  value: number;
  weight?: number;
}

export interface InterpolatedValue {
  value: number;
  variance?: number;
  confidence?: number;
}

export interface InterpolationOptions {
  power?: number; // IDW power parameter (default: 2)
  searchRadius?: number; // Maximum distance to consider points
  minPoints?: number; // Minimum points required for interpolation
  maxPoints?: number; // Maximum points to use
}

export interface GridPoint {
  lat: number;
  lng: number;
  value: number;
  variance?: number;
  weight?: number;
}

// =============================================================================
// INVERSE DISTANCE WEIGHTING (IDW)
// =============================================================================

/**
 * Inverse Distance Weighting interpolation
 * Classic spatial interpolation method
 * 
 * @param dataPoints - Array of known data points
 * @param targetLat - Target latitude
 * @param targetLng - Target longitude
 * @param options - Interpolation options
 */
export function interpolateIDW(
  dataPoints: DataPoint[],
  targetLat: number,
  targetLng: number,
  options: InterpolationOptions = {}
): InterpolatedValue {
  const { power = 2, searchRadius = Infinity, minPoints = 1, maxPoints = Infinity } = options;

  if (dataPoints.length < minPoints) {
    return { value: 0, confidence: 0 };
  }

  // Calculate distances and filter by search radius
  const pointsWithDistance = dataPoints
    .map((point) => ({
      ...point,
      distance: Math.sqrt(
        Math.pow(point.lat - targetLat, 2) + Math.pow(point.lng - targetLng, 2)
      ),
    }))
    .filter((p) => p.distance <= searchRadius)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxPoints);

  if (pointsWithDistance.length < minPoints) {
    return { value: 0, confidence: 0 };
  }

  // Check for exact match (avoid division by zero)
  const exactMatch = pointsWithDistance.find((p) => p.distance < 0.0001);
  if (exactMatch) {
    return { value: exactMatch.value, confidence: 1 };
  }

  // Calculate IDW weights
  let weightedSum = 0;
  let weightSum = 0;

  for (const point of pointsWithDistance) {
    const weight = 1 / Math.pow(point.distance, power);
    weightedSum += point.value * weight;
    weightSum += weight;
  }

  const value = weightSum > 0 ? weightedSum / weightSum : 0;
  
  // Confidence based on distance to nearest point
  const nearestDistance = pointsWithDistance[0]?.distance || Infinity;
  const confidence = Math.max(0, Math.min(1, 1 - nearestDistance / 2));

  return { value, confidence };
}

/**
 * Batch interpolation for multiple target points
 */
export function interpolateIDWBatch(
  dataPoints: DataPoint[],
  targets: Array<{ lat: number; lng: number }>,
  options: InterpolationOptions = {}
): InterpolatedValue[] {
  return targets.map((target) =>
    interpolateIDW(dataPoints, target.lat, target.lng, options)
  );
}

// =============================================================================
// KRIGING (ORDINARY KRIGING)
// =============================================================================

/**
 * Simple Ordinary Kriging implementation
 * More statistically robust than IDW, considers spatial autocorrelation
 */
export function interpolateKriging(
  dataPoints: DataPoint[],
  targetLat: number,
  targetLng: number,
  variogramModel: 'spherical' | 'exponential' | 'gaussian' = 'spherical'
): InterpolatedValue {
  if (dataPoints.length < 3) {
    // Fall back to IDW for insufficient points
    return interpolateIDW(dataPoints, targetLat, targetLng);
  }

  const n = dataPoints.length;

  // Calculate empirical variogram parameters (simplified)
  const { sill, range, nugget } = estimateVariogramParams(dataPoints);

  // Build Kriging matrix
  const K = new Array(n + 1).fill(0).map(() => new Array(n + 1).fill(0));
  const k = new Array(n + 1).fill(0);

  // Fill the Kriging matrix
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dist = Math.sqrt(
        Math.pow(dataPoints[i].lat - dataPoints[j].lat, 2) +
        Math.pow(dataPoints[i].lng - dataPoints[j].lng, 2)
      );
      K[i][j] = variogramFunction(dist, sill, range, nugget, variogramModel);
    }
    K[i][n] = 1;
    K[n][i] = 1;
  }
  K[n][n] = 0;

  // Calculate distances to target point
  for (let i = 0; i < n; i++) {
    const dist = Math.sqrt(
      Math.pow(dataPoints[i].lat - targetLat, 2) +
      Math.pow(dataPoints[i].lng - targetLng, 2)
    );
    k[i] = variogramFunction(dist, sill, range, nugget, variogramModel);
  }
  k[n] = 1;

  // Solve linear system (using simple Gaussian elimination)
  const weights = solveLinearSystem(K, k);

  if (!weights) {
    // Fall back to IDW if matrix solution fails
    return interpolateIDW(dataPoints, targetLat, targetLng);
  }

  // Calculate interpolated value
  let value = 0;
  let variance = 0;

  for (let i = 0; i < n; i++) {
    value += weights[i] * dataPoints[i].value;
    variance += weights[i] * k[i];
  }
  variance = sill - variance;

  return {
    value,
    variance: Math.max(0, variance),
    confidence: Math.max(0, Math.min(1, 1 - Math.sqrt(Math.abs(variance)) / sill)),
  };
}

/**
 * Variogram function (semivariance)
 */
function variogramFunction(
  distance: number,
  sill: number,
  range: number,
  nugget: number,
  model: 'spherical' | 'exponential' | 'gaussian'
): number {
  if (distance === 0) return 0;

  const h = distance / range;

  switch (model) {
    case 'spherical':
      if (distance >= range) return sill;
      return nugget + (sill - nugget) * (1.5 * h - 0.5 * Math.pow(h, 3));

    case 'exponential':
      return nugget + (sill - nugget) * (1 - Math.exp(-3 * h));

    case 'gaussian':
      return nugget + (sill - nugget) * (1 - Math.exp(-3 * h * h));

    default:
      return sill;
  }
}

/**
 * Estimate variogram parameters from data
 * Simplified method-of-moments estimator
 */
function estimateVariogramParams(dataPoints: DataPoint[]): {
  sill: number;
  range: number;
  nugget: number;
} {
  const n = dataPoints.length;
  
  // Calculate sample variance (sill)
  const mean = dataPoints.reduce((sum, p) => sum + p.value, 0) / n;
  const variance = dataPoints.reduce((sum, p) => sum + Math.pow(p.value - mean, 2), 0) / n;

  // Estimate range as 1/3 of max distance
  let maxDist = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dist = Math.sqrt(
        Math.pow(dataPoints[i].lat - dataPoints[j].lat, 2) +
        Math.pow(dataPoints[i].lng - dataPoints[j].lng, 2)
      );
      maxDist = Math.max(maxDist, dist);
    }
  }

  return {
    sill: variance,
    range: maxDist / 3,
    nugget: variance * 0.1, // 10% nugget effect
  };
}

/**
 * Solve linear system using Gaussian elimination with partial pivoting
 */
function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const augmented = A.map((row, i) => [...row, b[i]]);

  // Forward elimination with partial pivoting
  for (let i = 0; i < n; i++) {
    // Find pivot
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
        maxRow = k;
      }
    }
    [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];

    if (Math.abs(augmented[i][i]) < 1e-10) {
      return null; // Singular matrix
    }

    // Eliminate column
    for (let k = i + 1; k < n; k++) {
      const factor = augmented[k][i] / augmented[i][i];
      for (let j = i; j <= n; j++) {
        augmented[k][j] -= factor * augmented[i][j];
      }
    }
  }

  // Back substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = augmented[i][n];
    for (let j = i + 1; j < n; j++) {
      x[i] -= augmented[i][j] * x[j];
    }
    x[i] /= augmented[i][i];
  }

  return x;
}

// =============================================================================
// GRID GENERATION
// =============================================================================

/**
 * Generate an interpolated grid over a region
 */
export function generateInterpolatedGrid(
  dataPoints: DataPoint[],
  bounds: { north: number; south: number; east: number; west: number },
  resolution: number = 20,
  method: 'idw' | 'kriging' = 'idw',
  options: InterpolationOptions = {}
): GridPoint[] {
  const grid: GridPoint[] = [];
  const latRange = bounds.north - bounds.south;
  const lngRange = bounds.east - bounds.west;

  for (let i = 0; i <= resolution; i++) {
    for (let j = 0; j <= resolution; j++) {
      const lat = bounds.south + (i / resolution) * latRange;
      const lng = bounds.west + (j / resolution) * lngRange;

      const result =
        method === 'kriging'
          ? interpolateKriging(dataPoints, lat, lng)
          : interpolateIDW(dataPoints, lat, lng, options);

      grid.push({
        lat,
        lng,
        value: result.value,
        variance: result.variance,
        weight: result.confidence,
      });
    }
  }

  return grid;
}

/**
 * Generate a 2D array (matrix) of interpolated values
 * Useful for texture generation
 */
export function generateInterpolatedMatrix(
  dataPoints: DataPoint[],
  bounds: { north: number; south: number; east: number; west: number },
  width: number = 64,
  height: number = 64,
  method: 'idw' | 'kriging' = 'idw'
): Float32Array {
  const matrix = new Float32Array(width * height);
  const latRange = bounds.north - bounds.south;
  const lngRange = bounds.east - bounds.west;

  let index = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const lat = bounds.south + (y / (height - 1)) * latRange;
      const lng = bounds.west + (x / (width - 1)) * lngRange;

      const result =
        method === 'kriging'
          ? interpolateKriging(dataPoints, lat, lng)
          : interpolateIDW(dataPoints, lat, lng);

      matrix[index++] = result.value;
    }
  }

  return matrix;
}

// =============================================================================
// TEMPORAL INTERPOLATION
// =============================================================================

/**
 * Interpolate between two time snapshots
 */
export function interpolateTemporal(
  grid1: GridPoint[],
  grid2: GridPoint[],
  t: number // 0 to 1
): GridPoint[] {
  if (grid1.length !== grid2.length) {
    throw new Error('Grids must have the same size for temporal interpolation');
  }

  return grid1.map((point, i) => ({
    lat: point.lat,
    lng: point.lng,
    value: point.value + (grid2[i].value - point.value) * t,
    weight: point.weight,
  }));
}

// =============================================================================
// STATISTICS
// =============================================================================

/**
 * Calculate statistics for a grid
 */
export function calculateGridStats(grid: GridPoint[]): {
  min: number;
  max: number;
  mean: number;
  stdDev: number;
  percentiles: Record<number, number>;
} {
  const values = grid.map((p) => p.value).sort((a, b) => a - b);
  const n = values.length;

  const min = values[0];
  const max = values[n - 1];
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);

  const getPercentile = (p: number) => {
    const index = Math.floor((p / 100) * (n - 1));
    return values[index];
  };

  return {
    min,
    max,
    mean,
    stdDev,
    percentiles: {
      10: getPercentile(10),
      25: getPercentile(25),
      50: getPercentile(50),
      75: getPercentile(75),
      90: getPercentile(90),
    },
  };
}
