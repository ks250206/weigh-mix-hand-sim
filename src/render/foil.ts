import { Geometry3D, type Container3D } from "@pixi/3d";
import { Forms, group } from "./forms";
import { foilHalfSide } from "../contract";

// Both diagonals meet at the origin. Four rigid sectors preserve the area of the
// sheet and share the hinge edges as first one half, then two layers, turn over.
const firstAxis = { x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2 };
const secondAxis = { x: -Math.SQRT1_2, y: 0, z: Math.SQRT1_2 };
export const sheetHeight = 0.035;
const h = foilHalfSide;
const corners = [
  [-h, -h],
  [h, -h],
  [h, h],
  [-h, h],
] as const;

function facets(f: Forms, sector: number) {
  const [ax, az] = corners[sector],
    [bx, bz] = corners[(sector + 1) % 4];
  const positions: number[] = [],
    normals: number[] = [],
    colors: number[] = [];
  const segments = 5;
  function point(i: number, j: number) {
    const u = i / segments,
      v = j / segments;
    const x = ax * u + bx * v,
      z = az * u + bz * v;
    // Shallow crinkles meet at equal heights along each shared radial seam.
    const y = 0.017 * Math.sin(13 * x + 4 * z) * Math.sin(8 * z - 2 * x);
    return [x, y, z];
  }
  function triangle(a: number[], b: number[], c: number[]) {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      dz = b[2] - a[2];
    const ex = c[0] - a[0],
      ey = c[1] - a[1],
      ez = c[2] - a[2];
    const nx = dy * ez - dz * ey,
      ny = dz * ex - dx * ez,
      nz = dx * ey - dy * ex;
    const length = Math.hypot(nx, ny, nz);
    positions.push(...a, ...b, ...c);
    // Broken bands of reflected light cross the small facets of rolled aluminium.
    for (const [x, , z] of [a, b, c]) {
      normals.push(nx / length, ny / length, nz / length);
      const band = 0.5 + 0.5 * Math.cos(13 * x - 3.5 * z + (6 * ny) / length);
      const tone = 0.45 + 0.5 * band ** 2 + 0.04 * Math.sin(13 * z);
      colors.push(tone, tone, tone, 1);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; i + j < segments; j++) {
      const a = point(i, j),
        b = point(i + 1, j),
        c = point(i, j + 1);
      triangle(a, c, b);
      if (i + j + 1 < segments) triangle(b, c, point(i + 1, j + 1));
    }
  }
  return f.geometry(
    new Geometry3D({
      positions: Float32Array.from(positions),
      normals: Float32Array.from(normals),
      colors: Float32Array.from(colors),
    }),
  );
}

export function foilSheet(f: Forms, root: Container3D, accent: number) {
  const sheet = group(root);
  sheet.position.y = sheetHeight;
  const silver = f.material(0xe7ebef, 0.86);
  silver.vertexColors = true;
  const sectors = corners.map(([ax, az], i) => {
    const second = group(sheet),
      first = group(second);
    f.mesh(first, facets(f, i), silver);
    // Narrow reagent-coloured edge marks stay on the same pieces as they turn.
    const [bx, bz] = corners[(i + 1) % 4];
    const x = 0.76 * ax + 0.24 * bx,
      z = 0.76 * az + 0.24 * bz;
    const alongX = az === bz;
    f.box(
      first,
      accent,
      x * 0.98,
      0,
      z * 0.98,
      alongX ? 0.145 : 0.025,
      0.018,
      alongX ? 0.025 : 0.145,
    );
    return { first, second };
  });
  const creases = [-Math.PI / 4, Math.PI / 4].map(angle => {
    const line = f.box(sheet, f.ink(0x617b96, 0.58), 0, 0.046, 0, h * 2.65, 0.006, 0.012);
    line.rotation.y = angle;
    return line;
  });
  let previous = -1, previousOpen = -1;
  return (fold: number, opened = 0) => {
    if (fold === previous && opened === previousOpen) return;
    previous = fold;
    previousOpen = opened;
    // Unfold both creases into a shallow tray, retaining the visible diagonal folds.
    // The powder sits on the opened sheet, never inside the closed four-layer packet.
    const angle1 = Math.min(fold, 1) * Math.PI * (1 - opened) + 0.20 * opened,
      angle2 = Math.max(fold - 1, 0) * Math.PI * (1 - opened) + 0.20 * opened;
    creases.forEach(line => { line.visible = opened > 0.9; });
    sectors.forEach(({ first, second }, i) => {
      if (i === 0 || i === 1) {
        first.quaternion.setFromAxisAngle(firstAxis, angle1);
        first.position.y = 0.014 * (1 - Math.cos(angle1));
      }
      if (i === 1 || i === 2) {
        second.quaternion.setFromAxisAngle(secondAxis, angle2);
        second.position.y = 0.041 * (1 - Math.cos(angle2));
      }
    });
  };
}
