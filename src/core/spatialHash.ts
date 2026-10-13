/**
 * The broadphase: a uniform grid over the room, rebuilt every tick (GDD 9.4).
 *
 * GDD 9.4 budgets 40 entities and 200 projectiles. Testing every projectile
 * against every entity is 8,000 distance checks per tick, 480,000 per second,
 * and that is the version that does not hold 60fps on the five-year-old laptop
 * the budget names. Bucketing by position turns it into a handful of checks per
 * projectile, because a projectile is three world units across and the room is
 * a thousand.
 *
 * Three decisions worth stating, because each has a tempting alternative:
 *
 * 1. **A bounded grid, not a hash of unbounded coordinates.** Rooms have a
 *    known maximum size (`MAX_ROOM_SIZE` tiles), so the cell count is known at
 *    construction and the buckets are a flat `Int32Array`. A true hash would
 *    need either a `Map` -- whose iteration order the determinism contract in
 *    `core/world.ts` forbids relying on -- or modulo wrapping, which makes two
 *    distant entities share a bucket for no benefit here.
 *
 * 2. **Each item goes in exactly one cell, the one its centre is in.** The
 *    alternative, inserting into every cell the item's circle overlaps, needs a
 *    duplicate filter on every query. Instead the query expands its search box
 *    by the largest radius inserted, which cannot miss an overlap and costs one
 *    extra ring of cells.
 *
 * 3. **The query does the exact circle test itself.** A broadphase that returns
 *    "maybe" forces every caller to repeat the same narrowing loop, and the
 *    first caller to forget has a bug that only shows at cell boundaries. The
 *    cells are an implementation detail; the result is the true overlap set,
 *    which is also what makes it comparable to a brute-force check in a test.
 *
 * Allocation-free after construction: `clear`, `insert` and `query` touch only
 * typed arrays the caller owns or this owns.
 */

/** Cell edge in world units. Two tiles: big enough that a shot crosses few. */
export const DEFAULT_CELL_SIZE = 32;

/** Returned by `query` for a slot that is not a real entity. */
const EMPTY = -1;

export class SpatialHash {
  /** Largest item count that can be inserted before `insert` refuses. */
  readonly capacity: number;
  readonly cellSize: number;
  readonly columns: number;
  readonly rows: number;

  /** Head of each cell's chain, or -1. Index: `row * columns + column`. */
  private readonly cellHead: Int32Array;

  /** Next item in the same cell's chain, or -1. Index: item index. */
  private readonly nextInCell: Int32Array;

  // Item payload, parallel arrays indexed by item index.
  private readonly itemId: Int32Array;
  private readonly itemX: Float64Array;
  private readonly itemY: Float64Array;
  private readonly itemRadius: Float64Array;

  private itemCount = 0;

  /**
   * The largest radius currently inserted. Queries expand by it, so a query
   * cannot miss a big item whose centre sits in a cell the query did not visit.
   */
  private maxRadius = 0;

  constructor(widthPx: number, heightPx: number, capacity: number, cellSize = DEFAULT_CELL_SIZE) {
    if (!(widthPx > 0) || !(heightPx > 0)) {
      throw new RangeError(`world size must be positive, got ${widthPx}x${heightPx}`);
    }
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(`capacity must be a positive integer, got ${capacity}`);
    }
    if (!(cellSize > 0)) {
      throw new RangeError(`cell size must be positive, got ${cellSize}`);
    }

    this.capacity = capacity;
    this.cellSize = cellSize;
    this.columns = Math.max(1, Math.ceil(widthPx / cellSize));
    this.rows = Math.max(1, Math.ceil(heightPx / cellSize));

    this.cellHead = new Int32Array(this.columns * this.rows);
    this.nextInCell = new Int32Array(capacity);
    this.itemId = new Int32Array(capacity);
    this.itemX = new Float64Array(capacity);
    this.itemY = new Float64Array(capacity);
    this.itemRadius = new Float64Array(capacity);

    this.clear();
  }

  /** How many items are in the grid. */
  get count(): number {
    return this.itemCount;
  }

  /** Empties every cell. Call once per tick before re-inserting. */
  clear(): void {
    this.cellHead.fill(EMPTY);
    this.itemCount = 0;
    this.maxRadius = 0;
  }

  /**
   * Adds one circle. `id` is whatever the caller wants back out of `query` --
   * an entity storage slot, in this game.
   *
   * Returns false when the grid is full rather than throwing, matching the
   * entity registry: running out of room is a tuning problem, not a crash. The
   * caller sizes the grid to the pool it is indexing, so a false here means a
   * pool grew without the grid being told.
   */
  insert(id: number, x: number, y: number, radius: number): boolean {
    if (this.itemCount >= this.capacity) {
      return false;
    }

    const item = this.itemCount;
    this.itemCount += 1;

    this.itemId[item] = id;
    this.itemX[item] = x;
    this.itemY[item] = y;
    this.itemRadius[item] = radius;

    if (radius > this.maxRadius) {
      this.maxRadius = radius;
    }

    const cell = this.cellOf(x, y);
    this.nextInCell[item] = this.cellHead[cell] ?? EMPTY;
    this.cellHead[cell] = item;
    return true;
  }

  /**
   * Writes the id of every inserted circle that overlaps the circle
   * `(x, y, radius)` into `out`, and returns how many there were.
   *
   * "Overlaps" is `distance < rA + rB`, strictly: two circles exactly touching
   * are not a collision. Touching is the boundary case that a floating-point
   * position lands on only by construction, and calling it a miss means a
   * projectile resting flush against a target is not re-hit every tick.
   *
   * `out` must be at least `capacity` long. The alternative -- silently
   * truncating -- would turn a too-small buffer into missed collisions, which
   * is a bug that shows up as "the shot sometimes goes through" months later.
   */
  query(x: number, y: number, radius: number, out: Int32Array): number {
    if (out.length < this.capacity) {
      throw new RangeError(`query output buffer must hold ${this.capacity} ids, got ${out.length}`);
    }
    if (this.itemCount === 0) {
      return 0;
    }

    // Expanded by the largest radius inserted, because items are bucketed by
    // their centre alone (decision 2 at the top of this file).
    const reach = radius + this.maxRadius;
    const minColumn = this.clampColumn(Math.floor((x - reach) / this.cellSize));
    const maxColumn = this.clampColumn(Math.floor((x + reach) / this.cellSize));
    const minRow = this.clampRow(Math.floor((y - reach) / this.cellSize));
    const maxRow = this.clampRow(Math.floor((y + reach) / this.cellSize));

    let found = 0;

    for (let row = minRow; row <= maxRow; row += 1) {
      const rowBase = row * this.columns;

      for (let column = minColumn; column <= maxColumn; column += 1) {
        for (
          let item = this.cellHead[rowBase + column] ?? EMPTY;
          item !== EMPTY;
          item = this.nextInCell[item] ?? EMPTY
        ) {
          const dx = (this.itemX[item] ?? 0) - x;
          const dy = (this.itemY[item] ?? 0) - y;
          const sum = (this.itemRadius[item] ?? 0) + radius;

          if (dx * dx + dy * dy < sum * sum) {
            out[found] = this.itemId[item] ?? EMPTY;
            found += 1;
          }
        }
      }
    }

    return found;
  }

  /** The cell index containing a world position, clamped to the grid. */
  private cellOf(x: number, y: number): number {
    const column = this.clampColumn(Math.floor(x / this.cellSize));
    const row = this.clampRow(Math.floor(y / this.cellSize));
    return row * this.columns + column;
  }

  /**
   * Clamping rather than rejecting out-of-bounds positions is deliberate: the
   * edge cells become catch-alls for anything outside the room. Walls make that
   * unreachable in practice, but a clamp cannot drop an entity from the grid,
   * and dropping one would be an invisible failure to collide.
   */
  private clampColumn(column: number): number {
    return column < 0 ? 0 : column >= this.columns ? this.columns - 1 : column;
  }

  private clampRow(row: number): number {
    return row < 0 ? 0 : row >= this.rows ? this.rows - 1 : row;
  }
}
