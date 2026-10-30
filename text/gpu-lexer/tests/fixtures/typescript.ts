interface Point<T extends number = number> {
  readonly x: T;
  y?: T;
}

type Shape = { kind: "circle"; radius: number } | { kind: "square"; size: number };

export class Canvas implements Iterable<Shape> {
  private shapes: Shape[] = [];
  constructor(public readonly width: number, height = 480) {}
  add(shape: Shape): this { this.shapes.push(shape); return this; }
  *[Symbol.iterator]() { yield* this.shapes; }
}

enum Direction { Up = 1, Down, Left, Right }
const area = (s: Shape): number => s.kind === "circle" ? Math.PI * s.radius ** 2 : s.size * s.size;
