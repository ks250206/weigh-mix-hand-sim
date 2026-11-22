import { Vector3, type Container3D } from "@pixi/3d";
import type { ToolId } from "../contract";
import { Forms, group, type Point3 } from "./forms";

type Joint = readonly [number, number, number];
const up = { x: 0, y: 1, z: 0 };

/** All finger centers are in shaft space. Its Z axis runs from the working end
 * toward the butt. This attachment inherits the shaft's complete transform. */
export function toolGrip(f: Forms, shaft: Container3D, id: ToolId) {
  const frame = group(shaft);
  frame.position.y = 0.22;
  frame.rotation.x = Math.PI / 2;
  frame.visible = false;
  const rubber = f.material(0xf4e1a2, 0.12);
  function finger(radius: number, joints: Joint[]) {
    for (let i = 1; i < joints.length; i++) {
      const [x, y, z] = joints[i - 1],
        [ex, ey, ez] = joints[i];
      const delta = new Vector3(ex - x, ey - y, ez - z);
      const length = Math.hypot(delta.x, delta.y, delta.z);
      const pad = f.oval(
        frame,
        rubber,
        (x + ex) / 2,
        (y + ey) / 2,
        (z + ez) / 2,
        radius,
        length / 2 + radius * 0.74,
        radius,
      );
      pad.quaternion.setFromUnitVectors(up, delta.normalize());
    }
  }

  let wrist: Joint, direction: Joint;
  if (id === "spatula") {
    // Tripod pinch. The thumb and index pads touch opposite sides of the
    // narrow handle, with the middle finger supporting its underside.
    f.oval(frame, rubber, 0.154, 0.116, 0.18, 0.179, 0.12, 0.251);
    finger(0.056, [
      [0.18, 0.146, 0.103],
      [0.16, 0.164, -0.026],
      [0.129, 0.127, -0.106],
      [0.086, 0.051, -0.13],
    ]);
    finger(0.061, [
      [0.085, 0.117, 0.22],
      [-0.024, 0.146, 0.12],
      [-0.12, 0.087, 0.002],
      [-0.11, 0.009, -0.115],
    ]);
    finger(0.053, [
      [0.243, 0.095, 0.08],
      [0.213, -0.021, -0.026],
      [0.115, -0.106, -0.023],
      [0.028, -0.096, -0.022],
    ]);
    finger(0.052, [
      [0.27, 0.064, 0.18],
      [0.243, -0.057, 0.11],
      [0.151, -0.084, 0.104],
      [0.106, -0.044, 0.114],
    ]);
    finger(0.047, [
      [0.278, 0.072, 0.252],
      [0.26, -0.025, 0.207],
      [0.177, -0.066, 0.199],
      [0.134, -0.03, 0.2],
    ]);
    wrist = [0.18, 0.12, 0.43];
    direction = [0.08, 0.02, 0.28];
  } else {
    // A power grip encloses the thicker pestle with four staggered fingers;
    // the thumb crosses the wrapped index and middle fingers from below.
    f.oval(frame, rubber, 0.185, 0, 0.014, 0.128, 0.175, 0.26);
    for (const [i, z] of [-0.186, -0.066, 0.051, 0.162].entries()) {
      const r = 0.056 - 0.003 * i;
      finger(r, [
        [0.16, 0.093, z],
        [0.078, 0.147, z - 0.012],
        [-0.05, 0.14, z - 0.016],
        [-0.145 + 0.002 * i, 0.058, z - 0.004],
        [-0.135 + 0.002 * i, -0.071, z + 0.004],
      ]);
    }
    finger(0.064, [
      [0.19, -0.082, 0.106],
      [0.09, -0.169, 0.045],
      [-0.023, -0.163, -0.055],
      [-0.072, -0.126, -0.137],
    ]);
    wrist = [0.242, -0.157, 0.051];
    direction = [0.11, -0.27, 0.03];
  }

  const axis = new Vector3(...direction).normalize(),
    cuff = group(frame);
  cuff.position.set(...wrist);
  cuff.quaternion.setFromUnitVectors(up, axis);
  f.mesh(
    cuff,
    f.profile(
      [
        [0.118, -0.076],
        [0.149, -0.025],
        [0.177, 0.08],
        [0.187, 0.13],
        [0.195, 0.15],
        [0.185, 0.172],
      ],
      24,
    ),
    rubber,
  );
  const start = { x: 0, y: 0.152, z: 0 },
    end = { x: 0, y: 1.152, z: 0 };
  const position = new Vector3(),
    tangent = new Vector3();
  return {
    frame,
    wrist() {
      cuff.toGlobal(start, position);
      cuff.toGlobal(end, tangent);
      tangent.set(tangent.x - position.x, tangent.y - position.y, tangent.z - position.z);
      return { position, tangent };
    },
  };
}
export interface WristPose {
  position: Point3;
  tangent: Point3;
}
